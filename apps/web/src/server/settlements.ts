// 정산 (M9): 운영자 AD-16 (배분 정책 버전 · 월 계산 · 확정 · 이의 신청 답변 · 조정 · 지급 기록),
// 강사 I-08 (정산 명세 · 이의 신청 · CSV) · I-01 (이번 달 예상 정산액).
// 계산 · 저장은 packages/payments settlement, 돈 계산 규칙은 packages/core settlement.
// 강사에게는 구매자 · 주문 번호를 보여 주지 않는다 (결제일 · 과정 · 금액만, 화면상세기획 6장).
import {
  addMonths,
  CALCULATE_BLOCK_MESSAGE,
  calculateBlock,
  canObject,
  checkNewPolicy,
  isMonth,
  kstDate,
  kstMonth,
  LEARNING_RULES_V1,
  parseLearningRules,
  resolvePolicy,
  settlementSchedule,
} from "@aionit/core";
import type { Db } from "@aionit/db";
import { and, asc, desc, eq, inArray, isNotNull, isNull, schema, sql } from "@aionit/db";
import {
  addAdjustment,
  answerObjection,
  calculateMonth,
  computeMonth,
  confirmMonth,
  fileObjection,
  firstPolicyMonth,
  loadPolicies,
  recordPayout,
  SettlementError,
} from "@aionit/payments";
import { CourseError } from "./courses";
import { openPayoutAccount, payoutSummary } from "./instructors";
import { notify } from "./notifications";
import { writeAudit } from "./records";

interface Actor {
  actorId: string;
  headers?: Headers | null;
}

type InstructorRow = typeof schema.instructors.$inferSelect;

const kstStart = (day: string) => new Date(`${day}T00:00:00+09:00`);

// ---- 배분 정책 버전 (AD-16) ----

export const POLICY_SCOPE_LABEL = { default: "기본", instructor: "강사", course: "과정" } as const;

/** 정책 이름: 메모(예: 기본 정책 v1) + 시행일 */
export function policyName(p: { scope: keyof typeof POLICY_SCOPE_LABEL; note: string; effectiveFrom: Date }) {
  return `${p.note || `${POLICY_SCOPE_LABEL[p.scope]} 정책`} (${kstDate(p.effectiveFrom).replaceAll("-", ".")} 시행)`;
}

/** 모든 정책 버전 (시행일 순) + 지금 시행 중인 기본 정책 */
export async function policyOverview(db: Db, now = new Date()) {
  const rows = await db
    .select({
      policy: schema.revenuePolicies,
      instructorName: schema.instructors.displayName,
      courseTitle: schema.courses.title,
    })
    .from(schema.revenuePolicies)
    .leftJoin(
      schema.instructors,
      and(
        eq(schema.revenuePolicies.scope, "instructor"),
        eq(schema.instructors.id, schema.revenuePolicies.scopeId),
      ),
    )
    .leftJoin(
      schema.courses,
      and(eq(schema.revenuePolicies.scope, "course"), eq(schema.courses.id, schema.revenuePolicies.scopeId)),
    )
    .orderBy(desc(schema.revenuePolicies.effectiveFrom), asc(schema.revenuePolicies.scope));
  const policies = await loadPolicies(db);
  const current = resolvePolicy(policies, {}, now);
  return {
    rows: rows.map((r) => ({
      ...r.policy,
      target: r.instructorName ?? r.courseTitle ?? null,
      inForce: r.policy.effectiveFrom <= now,
      rules: r.policy.learningRules ? parseLearningRules(r.policy.learningRules) : null,
    })),
    current,
  };
}

export interface PolicyInput {
  scope: "default" | "course";
  courseId?: string | null;
  singleRateBp: number | null;
  poolRateBp: number | null;
  pgFeeRateBp: number | null;
  dailyCapHours: number | null;
  effectiveOn: string;
  note: string;
}

/**
 * 새 정책 버전 등록. 기본 정책은 모든 값을 정하고, 과정 예외는 단건 비율만 (비우면 예외를 푼다).
 * 시행일은 내일 이후, 강사에게 불리하면 30일 뒤부터. 등록하면 영향받는 강사에게 사이트 알림.
 * 강사별 단건 비율은 AD-15 (강사 관리) 에서 같은 규칙으로 등록한다.
 */
export async function createPolicy(db: Db, input: PolicyInput & Actor, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveOn))
    throw new CourseError("BAD_DATE", "시행일을 확인해 주세요.");
  const effectiveFrom = kstStart(input.effectiveOn);
  const policies = await loadPolicies(db);
  let courseOwner: string | null = null;
  if (input.scope === "course") {
    if (!input.courseId) throw new CourseError("NEED_COURSE", "과정을 골라 주세요.");
    const [course] = await db
      .select({ id: schema.courses.id, owner: schema.courses.ownerInstructorId })
      .from(schema.courses)
      .where(eq(schema.courses.id, input.courseId));
    if (!course) throw new CourseError("NOT_FOUND", "과정을 찾을 수 없습니다.", 404);
    courseOwner = course.owner;
  } else if (
    input.singleRateBp === null ||
    input.poolRateBp === null ||
    input.pgFeeRateBp === null ||
    !input.dailyCapHours
  ) {
    throw new CourseError(
      "NEED_ALL",
      "기본 정책은 단건 비율 · 구독 풀 비율 · 추정 수수료율 · 하루 상한을 모두 적어 주세요.",
    );
  }
  if (input.dailyCapHours !== null && !(input.dailyCapHours > 0 && input.dailyCapHours <= 24))
    throw new CourseError("BAD_CAP", "하루 상한은 0 ~ 24시간으로 적어 주세요.");
  const current = resolvePolicy(
    policies,
    { courseId: input.courseId ?? null, instructorId: courseOwner },
    effectiveFrom,
  );
  const check = checkNewPolicy(
    {
      effectiveFrom,
      current: current && {
        singleRateBp: current.singleRateBp,
        poolRateBp: current.poolRateBp,
        pgFeeRateBp: current.pgFeeRateBp,
      },
      next:
        input.scope === "course"
          ? { singleRateBp: input.singleRateBp ?? current?.singleRateBp }
          : {
              singleRateBp: input.singleRateBp,
              poolRateBp: input.poolRateBp,
              pgFeeRateBp: input.pgFeeRateBp,
            },
    },
    now,
  );
  if (check.block === "PAST_DATE")
    throw new CourseError(
      "PAST_DATE",
      "시행일은 내일 이후로 정해 주세요 (이미 생긴 매출에는 적용하지 않습니다).",
    );
  if (check.block === "NEEDS_NOTICE")
    throw new CourseError(
      "NEEDS_NOTICE",
      "강사에게 불리한 변경(비율 내림 · 수수료율 올림)은 30일 뒤부터 시행할 수 있습니다 (강사 이용약관 3).",
    );
  if (check.block === "BAD_RATE") throw new CourseError("BAD_RATE", "비율은 0 ~ 100% 로 적어 주세요.");
  const scopeId = input.scope === "course" ? input.courseId! : null;
  const [same] = await db
    .select({ id: schema.revenuePolicies.id })
    .from(schema.revenuePolicies)
    .where(
      and(
        eq(schema.revenuePolicies.scope, input.scope),
        scopeId ? eq(schema.revenuePolicies.scopeId, scopeId) : isNull(schema.revenuePolicies.scopeId),
        eq(schema.revenuePolicies.effectiveFrom, effectiveFrom),
      ),
    );
  if (same)
    throw new CourseError("SAME_DATE", "그 시행일의 정책이 이미 있습니다. 다른 날로 정해 주세요.", 409);
  const base = resolvePolicy(policies, {}, effectiveFrom)?.learningRules ?? LEARNING_RULES_V1;
  const learningRules =
    input.scope === "default"
      ? {
          ...base,
          version: `${input.effectiveOn}-cap${input.dailyCapHours}h`,
          dailyCapSec: Math.round(input.dailyCapHours! * 3600),
        }
      : null;
  const [row] = await db
    .insert(schema.revenuePolicies)
    .values({
      scope: input.scope,
      scopeId,
      singleRateBp: input.singleRateBp,
      subscriptionPoolRateBp: input.scope === "default" ? input.poolRateBp : null,
      pgFeeRateBp: input.scope === "default" ? input.pgFeeRateBp : null,
      learningRules,
      effectiveFrom,
      note: input.note.trim(),
      createdBy: input.actorId,
    })
    .returning();
  await writeAudit(db, {
    actorId: input.actorId,
    action: "revenue_policy.create",
    targetType: input.scope === "course" ? "course" : "revenue_policy",
    targetId: scopeId ?? row!.id,
    after: {
      policyId: row!.id,
      singleRateBp: input.singleRateBp,
      poolRateBp: input.poolRateBp,
      pgFeeRateBp: input.pgFeeRateBp,
      dailyCapSec: learningRules?.dailyCapSec ?? null,
      effectiveOn: input.effectiveOn,
      unfavorable: check.unfavorable,
    },
    headers: input.headers,
  });
  // 영향받는 강사에게 알린다 (기본 정책은 활동 중인 강사 모두, 과정 예외는 그 과정 강사)
  const targets = await db
    .select({ userId: schema.instructors.userId })
    .from(schema.instructors)
    .where(
      and(
        isNotNull(schema.instructors.userId),
        input.scope === "course"
          ? courseOwner
            ? eq(schema.instructors.id, courseOwner)
            : sql`false`
          : eq(schema.instructors.status, "active"),
      ),
    );
  for (const t of targets)
    await notify(db, {
      userId: t.userId!,
      kind: "settlement",
      title: `배분 정책이 바뀝니다 (${input.effectiveOn.replaceAll("-", ".")} 시행)`,
      body: "시행일 이후 매출부터 새 정책으로 정산합니다. 이미 확정된 정산은 바뀌지 않습니다.",
      url: "/instructor/settlements",
      targetId: row!.id,
    });
  return row!;
}

// ---- 월 정산 (AD-16) ----

/** 정산 월 목록 + 다음에 계산할 달 */
export async function settlementOverview(db: Db, now = new Date()) {
  const periods = await db
    .select({
      period: schema.settlementPeriods,
      instructors: sql<number>`(select count(*)::int from settlements s where s.period_id = settlement_periods.id)`,
      single: sql<number>`(select coalesce(sum(single_amount), 0)::bigint from settlements s where s.period_id = settlement_periods.id)`,
      subscription: sql<number>`(select coalesce(sum(subscription_amount), 0)::bigint from settlements s where s.period_id = settlement_periods.id)`,
      refund: sql<number>`(select coalesce(sum(refund_amount), 0)::bigint from settlements s where s.period_id = settlement_periods.id)`,
      payout: sql<number>`(select coalesce(sum(payout_amount), 0)::bigint from settlements s where s.period_id = settlement_periods.id)`,
      paid: sql<number>`(select count(*)::int from settlements s where s.period_id = settlement_periods.id and s.status = 'paid')`,
      toPay: sql<number>`(select count(*)::int from settlements s where s.period_id = settlement_periods.id and s.status = 'confirmed' and s.payout_amount > 0)`,
      objections: sql<number>`(select count(*)::int from settlement_objections o join settlements s on s.id = o.settlement_id where s.period_id = settlement_periods.id and o.answered_at is null)`,
    })
    .from(schema.settlementPeriods)
    .orderBy(desc(schema.settlementPeriods.month));
  const list = periods.map((p) => ({
    ...p.period,
    instructors: p.instructors,
    single: Number(p.single),
    subscription: Number(p.subscription),
    refund: Number(p.refund),
    payout: Number(p.payout),
    paid: p.paid,
    toPay: p.toPay,
    objections: p.objections,
  }));
  const simple = list.map((p) => ({ month: p.month, status: p.status }));
  const open = list.find((p) => p.status === "calculated");
  const latest = list.find((p) => p.status === "confirmed");
  // 처음이면 지난달, 단 기본 정책이 시행된 달보다 앞이면 그 달
  const first = await firstPolicyMonth(db);
  const lastMonth = addMonths(kstMonth(now), -1);
  const suggested =
    open?.month ?? (latest ? addMonths(latest.month, 1) : first && first > lastMonth ? first : lastMonth);
  const block = calculateBlock(suggested, simple, now, first);
  return {
    periods: list,
    suggested,
    block: block ? CALCULATE_BLOCK_MESSAGE[block] : null,
  };
}

export async function calculate(db: Db, month: string, actor: Actor, now = new Date()) {
  if (!isMonth(month)) throw new CourseError("BAD_MONTH", "정산 월을 확인해 주세요 (예: 2026-12).");
  const { periodId, result } = await calculateMonth(db, month, { actorId: actor.actorId, now });
  await writeAudit(db, {
    actorId: actor.actorId,
    action: "settlement.calculate",
    targetType: "settlement_period",
    targetId: periodId,
    after: {
      month,
      instructors: result.instructors.length,
      payout: result.instructors.reduce((n, i) => n + i.statement.payout, 0),
      pool: result.pool.allocatable,
      skippedNoPolicy: result.skippedNoPolicy,
    },
    headers: actor.headers,
  });
  return { periodId, result };
}

/** 확정 ➔ 강사에게 명세 공개 (사이트 알림). 그 뒤에는 바뀌지 않는다 */
export async function confirm(db: Db, month: string, actor: Actor, now = new Date()) {
  if (!isMonth(month)) throw new CourseError("BAD_MONTH", "정산 월을 확인해 주세요.");
  const done = await confirmMonth(db, month, { actorId: actor.actorId, now });
  await writeAudit(db, {
    actorId: actor.actorId,
    action: "settlement.confirm",
    targetType: "settlement_period",
    targetId: done.periodId,
    after: { month, settlements: done.settlements.length, payOn: done.payOn },
    headers: actor.headers,
  });
  const ids = done.settlements.map((s) => s.instructorId);
  const users = ids.length
    ? await db
        .select({ userId: schema.instructors.userId })
        .from(schema.instructors)
        .where(and(inArray(schema.instructors.id, ids), isNotNull(schema.instructors.userId)))
    : [];
  const [, m] = month.split("-");
  for (const u of users)
    await notify(db, {
      userId: u.userId!,
      kind: "settlement",
      title: `${Number(m)}월 정산 명세가 공개되었습니다`,
      body: `이의 신청은 ${done.objectionUntil.replaceAll("-", ".")} 까지, 지급 예정일은 ${done.payOn.replaceAll("-", ".")} 입니다.`,
      url: `/instructor/settlements/${month}`,
      targetId: done.periodId,
    });
  return done;
}

async function periodByMonth(db: Db, month: string) {
  if (!isMonth(month)) return null;
  const [row] = await db
    .select()
    .from(schema.settlementPeriods)
    .where(eq(schema.settlementPeriods.month, month));
  return row ?? null;
}

/** 운영자: 한 달의 강사별 정산 */
export async function adminPeriod(db: Db, month: string) {
  const period = await periodByMonth(db, month);
  if (!period) return null;
  const rows = await db
    .select({
      settlement: schema.settlements,
      displayName: schema.instructors.displayName,
      objections: sql<number>`(select count(*)::int from settlement_objections o where o.settlement_id = settlements.id and o.answered_at is null)`,
      paidOn: schema.payouts.paidOn,
    })
    .from(schema.settlements)
    .innerJoin(schema.instructors, eq(schema.instructors.id, schema.settlements.instructorId))
    .leftJoin(schema.payouts, eq(schema.payouts.settlementId, schema.settlements.id))
    .where(eq(schema.settlements.periodId, period.id))
    .orderBy(asc(schema.instructors.displayName));
  const policies = await policiesById(db, period.policyIds);
  return { period, rows, policies };
}

async function policiesById(db: Db, ids: string[]) {
  if (ids.length === 0) return [];
  const rows = await db
    .select()
    .from(schema.revenuePolicies)
    .where(inArray(schema.revenuePolicies.id, ids))
    .orderBy(asc(schema.revenuePolicies.effectiveFrom));
  return rows.map((p) => ({ ...p, name: policyName(p) }));
}

async function linesOf(db: Db, settlementId: string) {
  return db
    .select()
    .from(schema.settlementLines)
    .where(eq(schema.settlementLines.settlementId, settlementId))
    .orderBy(asc(schema.settlementLines.kind), asc(schema.settlementLines.occurredAt));
}

/** 운영자: 강사 한 명의 한 달 (근거 줄 · 이의 신청 · 지급 기록) */
export async function adminSettlement(db: Db, settlementId: string, reader: Actor) {
  const [row] = await db
    .select({
      settlement: schema.settlements,
      period: schema.settlementPeriods,
      instructor: schema.instructors,
    })
    .from(schema.settlements)
    .innerJoin(schema.settlementPeriods, eq(schema.settlementPeriods.id, schema.settlements.periodId))
    .innerJoin(schema.instructors, eq(schema.instructors.id, schema.settlements.instructorId))
    .where(eq(schema.settlements.id, settlementId));
  if (!row) return null;
  const [lines, objections, payout, policies, account] = await Promise.all([
    linesOf(db, settlementId),
    objectionsOf(db, settlementId),
    payoutOf(db, settlementId),
    policiesById(db, row.settlement.policyIds),
    payoutSummary(db, row.instructor.id, { ...reader, purpose: "정산 지급 확인 (AD-16)" }),
  ]);
  return { ...row, lines: statementLines(lines), objections, payout, policies, account };
}

async function objectionsOf(db: Db, settlementId: string) {
  return db
    .select({
      objection: schema.settlementObjections,
      adjustment: schema.settlementAdjustments,
    })
    .from(schema.settlementObjections)
    .leftJoin(
      schema.settlementAdjustments,
      eq(schema.settlementAdjustments.objectionId, schema.settlementObjections.id),
    )
    .where(eq(schema.settlementObjections.settlementId, settlementId))
    .orderBy(asc(schema.settlementObjections.createdAt));
}

async function payoutOf(db: Db, settlementId: string) {
  const [row] = await db.select().from(schema.payouts).where(eq(schema.payouts.settlementId, settlementId));
  return row ?? null;
}

/** 지급 기록 (계좌이체 뒤) ➔ 강사에게 사이트 알림 */
export async function payout(
  db: Db,
  settlementId: string,
  input: { paidOn: string; memo: string } & Actor,
  now = new Date(),
) {
  const done = await recordPayout(db, settlementId, { ...input, now });
  await writeAudit(db, {
    actorId: input.actorId,
    action: "settlement.payout",
    targetType: "settlement",
    targetId: settlementId,
    after: { paidOn: input.paidOn, amount: done.payout.amount },
    headers: input.headers,
  });
  const [owner] = await db
    .select({ userId: schema.instructors.userId, month: schema.settlementPeriods.month })
    .from(schema.instructors)
    .innerJoin(schema.settlements, eq(schema.settlements.instructorId, schema.instructors.id))
    .innerJoin(schema.settlementPeriods, eq(schema.settlementPeriods.id, schema.settlements.periodId))
    .where(eq(schema.settlements.id, settlementId));
  if (owner?.userId)
    await notify(db, {
      userId: owner.userId,
      kind: "settlement",
      title: `${Number(owner.month.slice(5))}월 정산금을 보냈습니다`,
      body: `${done.payout.amount.toLocaleString("ko-KR")}원 · ${input.paidOn.replaceAll("-", ".")}`,
      url: `/instructor/settlements/${owner.month}`,
      targetId: settlementId,
    });
  return done.payout;
}

/** 지급할 때만: 계좌번호 원문 (개인정보 조회 기록) */
export async function payoutAccount(db: Db, secret: string, settlementId: string, reader: Actor) {
  const [s] = await db
    .select({ instructorId: schema.settlements.instructorId, status: schema.settlements.status })
    .from(schema.settlements)
    .where(eq(schema.settlements.id, settlementId));
  if (!s) throw new SettlementError(404, "NOT_FOUND", "정산을 찾을 수 없습니다.");
  if (s.status === "calculated")
    throw new SettlementError(409, "NOT_CONFIRMED", "확정한 정산만 지급할 수 있습니다.");
  const account = await openPayoutAccount(db, secret, s.instructorId, {
    ...reader,
    purpose: "정산금 계좌이체 (AD-16)",
  });
  if (!account) throw new SettlementError(404, "NO_PROFILE", "강사의 정산 정보가 없습니다.");
  return account;
}

export async function answer(
  db: Db,
  objectionId: string,
  input: { answer: string; adjustment: number } & Actor,
) {
  const done = await answerObjection(db, objectionId, input);
  await writeAudit(db, {
    actorId: input.actorId,
    action: "settlement.objection_answer",
    targetType: "settlement",
    targetId: done.settlement.id,
    after: { objectionId, adjustment: input.adjustment, adjustmentId: done.adjustmentId },
    headers: input.headers,
  });
  const [owner] = await db
    .select({ userId: schema.instructors.userId })
    .from(schema.instructors)
    .where(eq(schema.instructors.id, done.settlement.instructorId));
  if (owner?.userId)
    await notify(db, {
      userId: owner.userId,
      kind: "settlement",
      title: `${Number(done.month.slice(5))}월 정산 이의 신청에 답변이 달렸습니다`,
      body:
        input.adjustment !== 0
          ? `다음 정산에 ${input.adjustment.toLocaleString("ko-KR")}원을 조정으로 넣습니다.`
          : input.answer.slice(0, 200),
      url: `/instructor/settlements/${done.month}`,
      targetId: done.settlement.id,
    });
  return done;
}

export async function adjust(
  db: Db,
  input: { instructorId: string; amount: number; reason: string } & Actor,
) {
  const row = await addAdjustment(db, input);
  await writeAudit(db, {
    actorId: input.actorId,
    action: "settlement.adjustment",
    targetType: "instructor",
    targetId: input.instructorId,
    after: { adjustmentId: row.id, amount: input.amount, reason: input.reason },
    headers: input.headers,
  });
  return row;
}

/** 아직 정산에 넣지 않은 조정 */
export async function pendingAdjustments(db: Db) {
  return db
    .select({ adjustment: schema.settlementAdjustments, displayName: schema.instructors.displayName })
    .from(schema.settlementAdjustments)
    .innerJoin(schema.instructors, eq(schema.instructors.id, schema.settlementAdjustments.instructorId))
    .where(
      sql`not exists (select 1 from settlement_lines l join settlements s on s.id = l.settlement_id
        where l.adjustment_id = ${schema.settlementAdjustments.id} and s.status <> 'calculated')`,
    )
    .orderBy(asc(schema.settlementAdjustments.createdAt));
}

// ---- 강사 (I-08 · I-01) ----

/** 강사: 공개된(확정한) 정산 명세 목록 */
export async function myStatements(db: Db, instructor: InstructorRow) {
  return db
    .select({ settlement: schema.settlements, month: schema.settlementPeriods.month })
    .from(schema.settlements)
    .innerJoin(schema.settlementPeriods, eq(schema.settlementPeriods.id, schema.settlements.periodId))
    .where(and(eq(schema.settlements.instructorId, instructor.id), sql`settlements.status <> 'calculated'`))
    .orderBy(desc(schema.settlementPeriods.month));
}

export interface StatementLine {
  id: string;
  kind: "single" | "refund" | "subscription" | "adjustment";
  /** KST 날짜 (구독은 그 달 1일) */
  date: string;
  courseTitle: string;
  paid: number | null;
  fee: number | null;
  feeEstimated: boolean;
  base: number;
  rateBp: number | null;
  amount: number;
  seconds?: number;
  totalSeconds?: number;
  pool?: number;
  reason?: string;
  saleMonth?: string;
}

const LINE_ORDER = { single: 0, subscription: 1, refund: 2, adjustment: 3 } as const;

/**
 * 근거 줄 ➔ 화면 · CSV 용 (주문 항목 · 환불 번호는 빼고 결제일 · 과정 · 금액만).
 * 순서는 명세와 같게 단건 ➔ 구독 배분 ➔ 환불 차감 ➔ 조정, 그 안에서는 날짜 순
 */
export function statementLines(rows: (typeof schema.settlementLines.$inferSelect)[]): StatementLine[] {
  const sorted = [...rows].sort(
    (a, b) => LINE_ORDER[a.kind] - LINE_ORDER[b.kind] || a.occurredAt.getTime() - b.occurredAt.getTime(),
  );
  return sorted.map((l) => {
    const d = l.detail;
    return {
      id: l.id,
      kind: l.kind,
      date: kstDate(l.occurredAt),
      courseTitle: (d.courseTitle as string | undefined) ?? "",
      paid: (d.paid as number | undefined) ?? (d.refund as number | undefined) ?? null,
      fee: (d.fee as number | undefined) ?? null,
      feeEstimated: d.feeEstimated === true,
      base: l.baseAmount,
      rateBp: l.rateBp,
      amount: l.amount,
      seconds: d.seconds as number | undefined,
      totalSeconds: d.totalSeconds as number | undefined,
      pool: d.pool as number | undefined,
      reason: d.reason as string | undefined,
      saleMonth: d.saleMonth as string | undefined,
    };
  });
}

/**
 * 강사: 한 달 명세. 공개(확정)된 것만, 자기 것만. 근거 줄에서 주문 항목 · 환불 번호를 빼고
 * 결제일 · 과정 · 금액만 돌려준다 (구매자 정보는 처음부터 줄에 없다).
 */
export async function myStatement(
  db: Db,
  instructor: InstructorRow,
  month: string,
  reader: Actor,
  now = new Date(),
) {
  const period = await periodByMonth(db, month);
  if (!period) return null;
  const [s] = await db
    .select()
    .from(schema.settlements)
    .where(
      and(eq(schema.settlements.periodId, period.id), eq(schema.settlements.instructorId, instructor.id)),
    );
  if (!s || s.status === "calculated") return null;
  const [rawLines, objections, paid, policies, account] = await Promise.all([
    linesOf(db, s.id),
    objectionsOf(db, s.id),
    payoutOf(db, s.id),
    policiesById(db, s.policyIds),
    payoutSummary(db, instructor.id, { ...reader, purpose: "정산 명세 보기 (I-08)" }),
  ]);
  const lines = statementLines(rawLines);
  return {
    month,
    settlement: s,
    lines,
    objections: objections.map((o) => ({
      body: o.objection.body,
      createdAt: o.objection.createdAt,
      answer: o.objection.answer,
      answeredAt: o.objection.answeredAt,
      adjustment: o.adjustment?.amount ?? null,
    })),
    payout: paid && { paidOn: paid.paidOn, amount: paid.amount },
    policies: policies.map((p) => ({ id: p.id, name: p.name })),
    account: account && { bankName: account.bankName, last4: account.bankAccountLast4 },
    canObject: canObject(s.publishedAt, now),
    schedule: settlementSchedule(month),
  };
}

export type MyStatement = NonNullable<Awaited<ReturnType<typeof myStatement>>>;

/** I-08 CSV: 명세의 근거 줄 (구매자 정보 없음). 엑셀에서 한글이 깨지지 않게 BOM 을 붙인다 */
export function statementCsv(statement: MyStatement): string {
  const KIND = {
    single: "단건",
    refund: "환불 차감",
    subscription: "구독 배분",
    adjustment: "조정",
  } as const;
  const esc = (v: unknown) => {
    const text = v === null || v === undefined ? "" : String(v);
    // 셀 수식으로 읽히지 않게 (=, +, -, @ 로 시작하는 글자)
    const safe = /^[=+\-@]/.test(text) && Number.isNaN(Number(text)) ? `'${text}` : text;
    return /[",\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
  };
  const rows = [
    ["구분", "날짜", "과정", "결제액", "정산 기준액", "비율(%)", "유효 학습 시간(초)", "강사 몫"],
    ...statement.lines.map((l) => [
      KIND[l.kind],
      l.date,
      l.kind === "adjustment" ? (l.reason ?? "") : l.courseTitle,
      l.paid ?? "",
      l.base,
      l.rateBp === null ? "" : (l.rateBp / 100).toString(),
      l.seconds ?? "",
      l.amount,
    ]),
  ];
  const s = statement.settlement;
  rows.push([]);
  for (const [label, value] of [
    ["단건 매출", s.singleAmount],
    ["구독 배분", s.subscriptionAmount],
    ["환불 차감", s.refundAmount],
    ["조정", s.adjustmentAmount],
    ["이월", s.carriedIn],
    ["원천징수", -s.withheld],
    ["부가세(세금계산서)", s.vatAmount],
    ["지급 예정액", s.payoutAmount],
  ] as const)
    rows.push([label, "", "", "", "", "", "", value]);
  return `\uFEFF${rows.map((r) => r.map(esc).join(",")).join("\r\n")}\r\n`;
}

export async function objectAs(
  db: Db,
  instructor: InstructorRow,
  settlementId: string,
  input: { body: string; userId: string; headers?: Headers | null },
  now = new Date(),
) {
  const row = await fileObjection(db, settlementId, {
    instructorId: instructor.id,
    authorId: input.userId,
    body: input.body,
    now,
  });
  await writeAudit(db, {
    actorId: input.userId,
    action: "settlement.objection",
    targetType: "settlement",
    targetId: settlementId,
    after: { objectionId: row.id, length: row.body.length },
    headers: input.headers,
  });
  // 운영자 모두에게 사이트 알림
  const operators = await db
    .select({ userId: schema.userRoles.userId })
    .from(schema.userRoles)
    .where(and(eq(schema.userRoles.role, "operator"), isNull(schema.userRoles.revokedAt)));
  const [period] = await db
    .select({ month: schema.settlementPeriods.month })
    .from(schema.settlementPeriods)
    .innerJoin(schema.settlements, eq(schema.settlements.periodId, schema.settlementPeriods.id))
    .where(eq(schema.settlements.id, settlementId));
  for (const op of operators)
    await notify(db, {
      userId: op.userId,
      kind: "settlement",
      title: `정산 이의 신청: ${instructor.displayName} (${period?.month ?? ""})`,
      body: row.body.slice(0, 200),
      url: `/admin/settlements/items/${settlementId}`,
      targetId: settlementId,
    });
  return row;
}

/**
 * I-01 이번 달 예상 정산액: 지금까지의 판매 · 환불 · 구독 배분(어제까지 학습 시간, 지금까지 들어온 구독 매출)으로
 * 계산한 강사 몫. 저장하지 않는다. 지난달을 아직 확정하지 않았으면 이월은 빠진다.
 */
export async function estimateThisMonth(db: Db, instructor: InstructorRow, now = new Date()) {
  const month = kstMonth(now);
  const result = await computeMonth(db, month, now);
  const mine = result.instructors.find((i) => i.instructorId === instructor.id);
  const s = mine?.statement;
  return {
    month,
    single: s?.single ?? 0,
    subscription: s?.subscription ?? 0,
    refund: s?.refund ?? 0,
    adjustment: s?.adjustment ?? 0,
    carriedIn: s?.carriedIn ?? 0,
    gross: s?.gross ?? 0,
    payout: s?.payout ?? 0,
    withheld: s?.withheld ?? 0,
    hold: s?.hold ?? null,
    schedule: settlementSchedule(month),
  };
}
