// 월 정산 (M9, docs/사이트구조_화면목록.md 9장). web(운영자 계산 · 확정 · 지급 기록, 강사 예상 정산액)과
// worker(매월 자동 계산)가 함께 쓴다. 돈 계산은 모두 packages/core settlement 가 하고, 여기는 DB 에서 읽고 쓰기만 한다.
//   단건: 그 달에 결제된 주문 항목 (단건 · 연장권 · 패키지). 판매 시각에 시행 중인 정책 (과정 ➔ 강사 ➔ 기본)
//   환불: 그 달 판매의 환불(확정 전) + 확정한 달 판매의 환불 중 아직 뺀 적 없는 것 (확정 후 ➔ 다음 달)
//   구독: 그 달 구독 기준액 × 풀 비율 ➔ 과정별 유효 학습 시간(구독으로 본 시간만) 비례
//   조정: 아직 넣은 적 없는 운영자 조정 (이의 신청 반영 등)
// 확정한 달은 DB 트리거가 지킨다 (마이그레이션 0010). 확정하지 않은 달은 몇 번이든 다시 계산한다.
import type {
  LearningAccess,
  PolicyVersion,
  SingleLine,
  Statement,
  SubscriptionPayment,
  TaxType,
} from "@aionit/core";
import {
  addMonths,
  allocatePool,
  CALCULATE_BLOCK_MESSAGE,
  calculateBlock,
  canObject,
  computeStatement,
  kstDate,
  kstMonth,
  learningAccess,
  monthRange,
  objectionDeadline,
  paymentFee,
  refundLine,
  resolvePolicy,
  settlementSchedule,
  singleSaleLine,
  splitByWeights,
  subscriptionPool,
  subscriptionSeconds,
} from "@aionit/core";
import type { Db } from "@aionit/db";
import { and, eq, gte, inArray, isNotNull, lt, lte, ne, schema, sql } from "@aionit/db";

export class SettlementError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type LineKind = (typeof schema.SETTLEMENT_LINE_KINDS)[number];

export interface LineDraft {
  kind: LineKind;
  courseId: string | null;
  orderItemId?: string | null;
  refundId?: string | null;
  adjustmentId?: string | null;
  policyId: string | null;
  occurredAt: Date;
  baseAmount: number;
  rateBp: number | null;
  amount: number;
  detail: Record<string, unknown>;
}

export interface InstructorMonth {
  instructorId: string;
  displayName: string;
  statement: Statement;
  lines: LineDraft[];
  policyIds: string[];
}

export interface MonthResult {
  month: string;
  pool: {
    base: number;
    pool: number;
    carryIn: number;
    carryOut: number;
    allocatable: number;
    seconds: number;
    policyIds: string[];
  };
  instructors: InstructorMonth[];
  /** 시행 중인 정책이 없어 빼 둔 판매 수 (기본 정책 시행 전 매출) */
  skippedNoPolicy: number;
}

export async function loadPolicies(db: Db): Promise<PolicyVersion[]> {
  const rows = await db.select().from(schema.revenuePolicies);
  return rows.map((r) => ({
    id: r.id,
    scope: r.scope,
    scopeId: r.scopeId,
    singleRateBp: r.singleRateBp,
    subscriptionPoolRateBp: r.subscriptionPoolRateBp,
    pgFeeRateBp: r.pgFeeRateBp,
    learningRules: r.learningRules,
    effectiveFrom: r.effectiveFrom,
  }));
}

const PAID_PAYMENT = ["done", "canceled", "partially_canceled"] as const;

async function feesOf(db: Db, orderIds: string[]) {
  if (orderIds.length === 0) return new Map<string, number | null>();
  const rows = await db
    .select({ orderId: schema.payments.orderId, fee: schema.payments.feeAmount })
    .from(schema.payments)
    .where(
      and(inArray(schema.payments.orderId, orderIds), inArray(schema.payments.status, [...PAID_PAYMENT])),
    );
  return new Map(rows.map((r) => [r.orderId, r.fee]));
}

interface SaleRow {
  itemId: string;
  orderId: string;
  productId: string;
  productType: string;
  courseId: string | null;
  productName: string;
  paid: number;
  vat: number;
  paidAt: Date;
}

const saleColumns = {
  itemId: schema.orderItems.id,
  orderId: schema.orderItems.orderId,
  productId: schema.orderItems.productId,
  productType: schema.orderItems.productType,
  courseId: schema.orderItems.courseId,
  productName: schema.orderItems.productName,
  paid: schema.orderItems.paidAmount,
  vat: schema.orderItems.vatAmount,
  paidAt: schema.orders.paidAt,
};

/**
 * 판매 한 건 ➔ 과정별 단건 줄 (강사 몫). 패키지는 각 강의 정가 비율로 결제액 · 부가세 · 수수료를 나눈 뒤 계산한다.
 * 정책은 판매 시각에 시행 중인 것. 소유 강사가 없는 과정(플랫폼 과정)은 줄을 만들지 않는다.
 */
function saleParts(
  sale: SaleRow,
  fee: number | null,
  ctx: {
    policies: PolicyVersion[];
    courses: Map<string, CourseInfo>;
    bundles: Map<string, { courseId: string; weight: number }[]>;
  },
): { courseId: string; instructorId: string; line: SingleLine; policyId: string; weight: number }[] | null {
  const base = resolvePolicy(ctx.policies, {}, sale.paidAt);
  if (!base) return null;
  const totalFee = paymentFee(sale.paid, fee, base.pgFeeRateBp).fee;
  const items =
    sale.productType === "bundle"
      ? (ctx.bundles.get(sale.productId) ?? [])
      : sale.courseId
        ? [{ courseId: sale.courseId, weight: 1 }]
        : [];
  if (items.length === 0) return [];
  const weights = items.map((i) => ({ key: i.courseId, weight: i.weight }));
  const paid = splitByWeights(sale.paid, weights);
  const vat = splitByWeights(sale.vat, weights);
  const fees = splitByWeights(totalFee, weights);
  const out: {
    courseId: string;
    instructorId: string;
    line: SingleLine;
    policyId: string;
    weight: number;
  }[] = [];
  items.forEach((item, i) => {
    const course = ctx.courses.get(item.courseId);
    if (!course?.ownerInstructorId) return;
    const policy = resolvePolicy(
      ctx.policies,
      { courseId: item.courseId, instructorId: course.ownerInstructorId },
      sale.paidAt,
    )!;
    const line = singleSaleLine(
      { paid: paid[i]!.amount, vat: vat[i]!.amount, fee: fees[i]!.amount },
      { singleRateBp: policy.singleRateBp, pgFeeRateBp: policy.pgFeeRateBp },
    );
    // 기록된 수수료인지 추정인지는 결제 전체 기준
    line.feeEstimated = fee === null;
    out.push({
      courseId: item.courseId,
      instructorId: course.ownerInstructorId,
      line,
      policyId: policy.from.single,
      weight: item.weight,
    });
  });
  return out;
}

interface CourseInfo {
  id: string;
  title: string;
  ownerInstructorId: string | null;
  inSubscription: boolean;
}

/**
 * 한 달 계산 (DB 에 쓰지 않는다). 확정한 달의 다음 달이 아니어도 계산은 되므로 (예상 정산액),
 * 순서 확인은 calculateMonth 가 한다. now 까지 끝난 환불만 본다.
 */
export async function computeMonth(db: Db, month: string, now = new Date()): Promise<MonthResult> {
  const { from, to } = monthRange(month);
  const policies = await loadPolicies(db);
  const periods = await db.select().from(schema.settlementPeriods);
  const current = periods.find((p) => p.month === month) ?? null;
  const confirmed = periods
    .filter((p) => p.status === "confirmed")
    .map((p) => p.month)
    .sort();
  const latestConfirmed = confirmed.filter((m) => m < month).at(-1) ?? null;
  const firstMonth = [...periods.map((p) => p.month), month].sort()[0]!;
  const prev = periods.find((p) => p.month === addMonths(month, -1) && p.status === "confirmed") ?? null;

  const courses = new Map<string, CourseInfo>(
    (
      await db
        .select({
          id: schema.courses.id,
          title: schema.courses.title,
          ownerInstructorId: schema.courses.ownerInstructorId,
          inSubscription: schema.courses.inSubscription,
        })
        .from(schema.courses)
    ).map((c) => [c.id, c]),
  );
  const bundles = new Map<string, { courseId: string; weight: number }[]>();
  for (const item of await db
    .select({
      productId: schema.productItems.productId,
      courseId: schema.productItems.courseId,
      weight: schema.productItems.listPriceWeight,
    })
    .from(schema.productItems)
    .innerJoin(schema.products, eq(schema.products.id, schema.productItems.productId))
    .where(eq(schema.products.type, "bundle"))) {
    const list = bundles.get(item.productId) ?? [];
    list.push({ courseId: item.courseId, weight: item.weight ?? 0 });
    bundles.set(item.productId, list);
  }
  const ctx = { policies, courses, bundles };

  const lines = new Map<string, LineDraft[]>();
  const push = (instructorId: string, line: LineDraft) => {
    const list = lines.get(instructorId) ?? [];
    list.push(line);
    lines.set(instructorId, list);
  };
  let skippedNoPolicy = 0;

  // ---- 단건 판매 ----
  const sales: SaleRow[] = (
    await db
      .select(saleColumns)
      .from(schema.orderItems)
      .innerJoin(schema.orders, eq(schema.orders.id, schema.orderItems.orderId))
      .where(
        and(
          isNotNull(schema.orders.paidAt),
          gte(schema.orders.paidAt, from),
          lt(schema.orders.paidAt, to),
          lte(schema.orders.paidAt, now),
          ne(schema.orderItems.productType, "subscription"),
        ),
      )
  ).map((s) => ({ ...s, paidAt: s.paidAt! }));

  // ---- 환불 (단건): 이 달 판매의 환불 + 확정한 달 판매의 환불 중 아직 뺀 적 없는 것 ----
  const doneRefunds = await db
    .select({
      id: schema.refunds.id,
      itemId: schema.refunds.orderItemId,
      amount: schema.refunds.approvedAmount,
      doneAt: schema.refunds.doneAt,
      saleAt: schema.orders.paidAt,
    })
    .from(schema.refunds)
    .innerJoin(schema.orderItems, eq(schema.orderItems.id, schema.refunds.orderItemId))
    .innerJoin(schema.orders, eq(schema.orders.id, schema.orderItems.orderId))
    .where(
      and(
        eq(schema.refunds.status, "done"),
        lte(schema.refunds.doneAt, now),
        ne(schema.orderItems.productType, "subscription"),
        isNotNull(schema.orders.paidAt),
        lt(schema.orders.paidAt, to),
      ),
    );
  const settledRefunds = new Set(
    (
      await db
        .select({ refundId: schema.settlementLines.refundId })
        .from(schema.settlementLines)
        .innerJoin(schema.settlements, eq(schema.settlements.id, schema.settlementLines.settlementId))
        .where(
          and(
            isNotNull(schema.settlementLines.refundId),
            current ? ne(schema.settlements.periodId, current.id) : undefined,
          ),
        )
    ).map((r) => r.refundId!),
  );
  const refunds = doneRefunds.filter((r) => {
    if (settledRefunds.has(r.id)) return false;
    const saleMonth = kstMonth(r.saleAt!);
    if (saleMonth === month) return true;
    return !!latestConfirmed && saleMonth <= latestConfirmed && saleMonth >= firstMonth;
  });
  const refundSales = new Map<string, SaleRow>(sales.map((s) => [s.itemId, s]));
  const missing = [...new Set(refunds.map((r) => r.itemId))].filter((id) => !refundSales.has(id));
  if (missing.length > 0) {
    for (const s of await db
      .select(saleColumns)
      .from(schema.orderItems)
      .innerJoin(schema.orders, eq(schema.orders.id, schema.orderItems.orderId))
      .where(inArray(schema.orderItems.id, missing)))
      refundSales.set(s.itemId, { ...s, paidAt: s.paidAt! });
  }
  const fees = await feesOf(db, [...new Set([...refundSales.values()].map((s) => s.orderId))]);

  for (const sale of sales) {
    const parts = saleParts(sale, fees.get(sale.orderId) ?? null, ctx);
    if (!parts) {
      skippedNoPolicy += 1;
      continue;
    }
    for (const part of parts) {
      push(part.instructorId, {
        kind: "single",
        courseId: part.courseId,
        orderItemId: sale.itemId,
        policyId: part.policyId,
        occurredAt: sale.paidAt,
        baseAmount: part.line.base,
        rateBp: part.line.rateBp,
        amount: part.line.amount,
        detail: {
          courseTitle: courses.get(part.courseId)?.title ?? sale.productName,
          productType: sale.productType,
          paid: part.line.paid,
          vat: part.line.vat,
          fee: part.line.fee,
          feeEstimated: part.line.feeEstimated,
        },
      });
    }
  }

  for (const refund of refunds) {
    const sale = refundSales.get(refund.itemId);
    if (!sale) continue;
    const parts = saleParts(sale, fees.get(sale.orderId) ?? null, ctx);
    if (!parts || parts.length === 0) continue;
    const amounts = splitByWeights(
      refund.amount ?? 0,
      parts.map((p) => ({ key: p.courseId, weight: p.weight })),
    );
    parts.forEach((part, i) => {
      const line = refundLine(part.line, amounts[i]!.amount);
      push(part.instructorId, {
        kind: "refund",
        courseId: part.courseId,
        orderItemId: sale.itemId,
        refundId: refund.id,
        policyId: part.policyId,
        occurredAt: refund.doneAt!,
        baseAmount: -line.base,
        rateBp: line.rateBp,
        amount: line.amount,
        detail: {
          courseTitle: courses.get(part.courseId)?.title ?? sale.productName,
          refund: line.paid,
          vat: line.vat,
          fee: line.fee,
          saleMonth: kstMonth(sale.paidAt),
          afterConfirm: kstMonth(sale.paidAt) !== month,
        },
      });
    });
  }

  // ---- 구독 ----
  const yearStart = monthRange(addMonths(month, -11)).from;
  const subRows = await db
    .select({
      ...saleColumns,
      interval: schema.subscriptions.interval,
    })
    .from(schema.orderItems)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.orderItems.orderId))
    .innerJoin(schema.subscriptionCycles, eq(schema.subscriptionCycles.orderId, schema.orders.id))
    .innerJoin(schema.subscriptions, eq(schema.subscriptions.id, schema.subscriptionCycles.subscriptionId))
    .where(
      and(
        eq(schema.orderItems.productType, "subscription"),
        isNotNull(schema.orders.paidAt),
        gte(schema.orders.paidAt, yearStart),
        lt(schema.orders.paidAt, to),
        lte(schema.orders.paidAt, now),
      ),
    );
  const subFees = await feesOf(
    db,
    subRows.map((r) => r.orderId),
  );
  const subRefunds = subRows.length
    ? await db
        .select({
          id: schema.refunds.id,
          itemId: schema.refunds.orderItemId,
          amount: schema.refunds.approvedAmount,
          doneAt: schema.refunds.doneAt,
        })
        .from(schema.refunds)
        .where(
          and(
            eq(schema.refunds.status, "done"),
            inArray(
              schema.refunds.orderItemId,
              subRows.map((r) => r.itemId),
            ),
            lt(schema.refunds.doneAt, to),
            lte(schema.refunds.doneAt, now),
          ),
        )
    : [];
  const payments: SubscriptionPayment[] = subRows.map((r) => ({
    id: r.itemId,
    paidAt: r.paidAt!,
    paid: r.paid,
    vat: r.vat,
    fee: subFees.get(r.orderId) ?? null,
    interval: r.interval,
    refunds: subRefunds
      .filter((x) => x.itemId === r.itemId)
      .map((x) => ({ id: x.id, doneAt: x.doneAt!, amount: x.amount ?? 0 })),
  }));
  const pool = subscriptionPool(
    payments,
    month,
    (at) => resolvePolicy(policies, {}, at),
    prev?.poolCarryOut ?? 0,
  );
  const poolPolicyIds = [...new Set(pool.parts.map((p) => p.policyId))];

  // 유효 학습 시간: 구독 포함 과정을 구독으로 본 시간만 (단건 · 발급 수강권으로 본 시간은 뺀다, D3)
  const days = { from: kstDate(from), to: kstDate(new Date(to.getTime() - 1)) };
  const timeRows = await db
    .select({
      userId: schema.learningTimeDaily.userId,
      courseId: schema.learningTimeDaily.courseId,
      date: schema.learningTimeDaily.date,
      effectiveSec: schema.learningTimeDaily.effectiveSec,
      access: schema.learningTimeDaily.access,
    })
    .from(schema.learningTimeDaily)
    .where(
      and(
        gte(schema.learningTimeDaily.date, days.from),
        lte(schema.learningTimeDaily.date, days.to),
        sql`${schema.learningTimeDaily.effectiveSec} > 0`,
      ),
    );
  const unknownUsers = [...new Set(timeRows.filter((r) => !r.access && r.userId).map((r) => r.userId!))];
  const ents = new Map<string, (typeof schema.entitlements.$inferSelect)[]>();
  if (unknownUsers.length > 0) {
    for (const e of await db
      .select()
      .from(schema.entitlements)
      .where(inArray(schema.entitlements.userId, unknownUsers))) {
      const list = ents.get(e.userId) ?? [];
      list.push(e);
      ents.set(e.userId, list);
    }
  }
  const subscriptionCourses = new Set([...courses.values()].filter((c) => c.inSubscription).map((c) => c.id));
  const seconds = subscriptionSeconds(
    timeRows.map((r) => {
      const course = courses.get(r.courseId);
      let access: LearningAccess = r.access ?? "none";
      if (!r.access && r.userId && course) access = learningAccess(ents.get(r.userId) ?? [], course, r.date);
      return { courseId: r.courseId, effectiveSec: r.effectiveSec, access };
    }),
    subscriptionCourses,
  );
  const totalSeconds = [...seconds.values()].reduce((n, s) => n + s, 0);
  for (const part of allocatePool(pool.allocatable, seconds)) {
    const owner = courses.get(part.courseId)?.ownerInstructorId;
    if (!owner) continue;
    push(owner, {
      kind: "subscription",
      courseId: part.courseId,
      policyId: null,
      occurredAt: from,
      baseAmount: pool.allocatable,
      rateBp: part.shareBp,
      amount: part.amount,
      detail: {
        courseTitle: courses.get(part.courseId)?.title ?? "",
        seconds: part.seconds,
        totalSeconds,
        shareBp: part.shareBp,
        pool: pool.allocatable,
        policyIds: poolPolicyIds,
      },
    });
  }

  // ---- 조정 (아직 넣은 적 없는 것) ----
  const adjustments = await db
    .select()
    .from(schema.settlementAdjustments)
    .where(
      and(
        lte(schema.settlementAdjustments.createdAt, now),
        sql`not exists (select 1 from settlement_lines l join settlements s on s.id = l.settlement_id
          where l.adjustment_id = ${schema.settlementAdjustments.id}
          ${current ? sql`and s.period_id <> ${current.id}` : sql``})`,
      ),
    );
  for (const adj of adjustments) {
    push(adj.instructorId, {
      kind: "adjustment",
      courseId: null,
      adjustmentId: adj.id,
      policyId: null,
      occurredAt: adj.createdAt,
      baseAmount: adj.amount,
      rateBp: null,
      amount: adj.amount,
      detail: { reason: adj.reason, objectionId: adj.objectionId },
    });
  }

  // ---- 강사별 명세 ----
  const carried = new Map<string, number>();
  if (prev) {
    for (const s of await db
      .select({ instructorId: schema.settlements.instructorId, carryOut: schema.settlements.carryOut })
      .from(schema.settlements)
      .where(eq(schema.settlements.periodId, prev.id)))
      if (s.carryOut !== 0) carried.set(s.instructorId, s.carryOut);
  }
  const ids = [...new Set([...lines.keys(), ...carried.keys()])];
  const people = ids.length
    ? await db
        .select({
          id: schema.instructors.id,
          displayName: schema.instructors.displayName,
          taxType: schema.payoutProfiles.taxType,
        })
        .from(schema.instructors)
        .leftJoin(schema.payoutProfiles, eq(schema.payoutProfiles.instructorId, schema.instructors.id))
        .where(inArray(schema.instructors.id, ids))
    : [];
  const sum = (list: LineDraft[], kind: LineKind) =>
    list.filter((l) => l.kind === kind).reduce((n, l) => n + l.amount, 0);
  const instructors: InstructorMonth[] = people
    .map((person) => {
      const list = (lines.get(person.id) ?? []).sort(
        (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
      );
      const statement = computeStatement({
        single: sum(list, "single"),
        subscription: sum(list, "subscription"),
        refund: sum(list, "refund"),
        adjustment: sum(list, "adjustment"),
        carriedIn: carried.get(person.id) ?? 0,
        taxType: (person.taxType as TaxType | null) ?? null,
      });
      const policyIds = [
        ...new Set([
          ...list.map((l) => l.policyId).filter((x): x is string => !!x),
          ...(list.some((l) => l.kind === "subscription") ? poolPolicyIds : []),
        ]),
      ];
      return { instructorId: person.id, displayName: person.displayName, statement, lines: list, policyIds };
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "ko"));

  return {
    month,
    pool: {
      base: pool.base,
      pool: pool.pool,
      carryIn: prev?.poolCarryOut ?? 0,
      carryOut: pool.carryOut,
      allocatable: pool.allocatable,
      seconds: totalSeconds,
      policyIds: poolPolicyIds,
    },
    instructors,
    skippedNoPolicy,
  };
}

const LOCK = sql`select pg_advisory_xact_lock(hashtext('aionit.settlement'))`;

async function periodRows(db: Db) {
  return db
    .select({
      id: schema.settlementPeriods.id,
      month: schema.settlementPeriods.month,
      status: schema.settlementPeriods.status,
    })
    .from(schema.settlementPeriods);
}

/** 운영자(AD-16) · worker: 한 달을 계산해 저장한다. 확정하지 않은 달이면 지우고 다시 계산한다 */
export async function calculateMonth(
  db: Db,
  month: string,
  options: { actorId?: string | null; now?: Date } = {},
) {
  const now = options.now ?? new Date();
  const block = calculateBlock(month, await periodRows(db), now);
  if (block) throw new SettlementError(409, block, CALCULATE_BLOCK_MESSAGE[block]);
  const result = await computeMonth(db, month, now);
  const allPolicyIds = [
    ...new Set([...result.pool.policyIds, ...result.instructors.flatMap((i) => i.policyIds)]),
  ];
  const periodId = await db.transaction(async (tx) => {
    await tx.execute(LOCK);
    const again = calculateBlock(month, await periodRows(tx as unknown as Db), now);
    if (again) throw new SettlementError(409, again, CALCULATE_BLOCK_MESSAGE[again]);
    const values = {
      subscriptionBase: result.pool.base,
      subscriptionPool: result.pool.pool,
      poolCarryIn: result.pool.carryIn,
      poolCarryOut: result.pool.carryOut,
      subscriptionSeconds: result.pool.seconds,
      policyIds: allPolicyIds,
      calculatedAt: now,
      calculatedBy: options.actorId ?? null,
    };
    const [existing] = await tx
      .select({ id: schema.settlementPeriods.id })
      .from(schema.settlementPeriods)
      .where(eq(schema.settlementPeriods.month, month));
    let id: string;
    if (existing) {
      id = existing.id;
      const old = tx
        .select({ id: schema.settlements.id })
        .from(schema.settlements)
        .where(eq(schema.settlements.periodId, id));
      await tx.delete(schema.settlementLines).where(inArray(schema.settlementLines.settlementId, old));
      await tx.delete(schema.settlements).where(eq(schema.settlements.periodId, id));
      await tx.update(schema.settlementPeriods).set(values).where(eq(schema.settlementPeriods.id, id));
    } else {
      const [row] = await tx
        .insert(schema.settlementPeriods)
        .values({ month, ...values })
        .returning({ id: schema.settlementPeriods.id });
      id = row!.id;
    }
    for (const person of result.instructors) {
      const s = person.statement;
      const [row] = await tx
        .insert(schema.settlements)
        .values({
          periodId: id,
          instructorId: person.instructorId,
          singleAmount: s.single,
          subscriptionAmount: s.subscription,
          refundAmount: s.refund,
          adjustmentAmount: s.adjustment,
          carriedIn: s.carriedIn,
          grossAmount: s.gross,
          incomeTax: s.incomeTax,
          localTax: s.localTax,
          withheld: s.withheld,
          vatAmount: s.vat,
          payoutAmount: s.payout,
          carryOut: s.carryOut,
          holdReason: s.hold,
          taxType: s.taxType,
          policyIds: person.policyIds,
        })
        .returning({ id: schema.settlements.id });
      if (person.lines.length > 0)
        await tx.insert(schema.settlementLines).values(
          person.lines.map((l) => ({
            settlementId: row!.id,
            kind: l.kind,
            courseId: l.courseId,
            orderItemId: l.orderItemId ?? null,
            refundId: l.refundId ?? null,
            adjustmentId: l.adjustmentId ?? null,
            policyId: l.policyId,
            occurredAt: l.occurredAt,
            baseAmount: l.baseAmount,
            rateBp: l.rateBp,
            amount: l.amount,
            detail: l.detail,
          })),
        );
    }
    return id;
  });
  return { periodId, result };
}

/**
 * 확정: 금액을 굳히고 강사에게 명세를 공개한다 (이의 신청 5일, 지급 예정일).
 * 지급 예정일은 다음 달 15일, 늦게 확정해 이의 신청 기간이 그보다 길면 그 마감일.
 */
export async function confirmMonth(db: Db, month: string, options: { actorId: string; now?: Date }) {
  const now = options.now ?? new Date();
  return db.transaction(async (tx) => {
    await tx.execute(LOCK);
    const periods = await periodRows(tx as unknown as Db);
    const period = periods.find((p) => p.month === month);
    if (!period) throw new SettlementError(404, "NOT_CALCULATED", "아직 계산하지 않은 달입니다.");
    if (period.status === "confirmed") throw new SettlementError(409, "CONFIRMED", "이미 확정한 달입니다.");
    const block = calculateBlock(month, periods, now);
    if (block) throw new SettlementError(409, block, CALCULATE_BLOCK_MESSAGE[block]);
    const until = objectionDeadline(now);
    const payOn = [settlementSchedule(month).payOn, until].sort().at(-1)!;
    const rows = await tx
      .update(schema.settlements)
      .set({ status: "confirmed", publishedAt: now, objectionUntil: until, payOn })
      .where(eq(schema.settlements.periodId, period.id))
      .returning({ id: schema.settlements.id, instructorId: schema.settlements.instructorId });
    await tx
      .update(schema.settlementPeriods)
      .set({ status: "confirmed", confirmedAt: now, confirmedBy: options.actorId })
      .where(eq(schema.settlementPeriods.id, period.id));
    return { periodId: period.id, settlements: rows, objectionUntil: until, payOn };
  });
}

/** 지급 기록 (시스템 밖 계좌이체를 한 뒤): 일자 · 금액(지급 예정액 그대로) · 담당자 · 메모 */
export async function recordPayout(
  db: Db,
  settlementId: string,
  input: { paidOn: string; memo: string; actorId: string; now?: Date },
) {
  const now = input.now ?? new Date();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.paidOn) || input.paidOn > kstDate(now))
    throw new SettlementError(400, "BAD_DATE", "지급일을 확인해 주세요 (오늘 이전).");
  return db.transaction(async (tx) => {
    const [s] = await tx
      .select()
      .from(schema.settlements)
      .where(eq(schema.settlements.id, settlementId))
      .for("update");
    if (!s) throw new SettlementError(404, "NOT_FOUND", "정산을 찾을 수 없습니다.");
    if (s.status === "paid") throw new SettlementError(409, "PAID", "이미 지급 기록이 있습니다.");
    if (s.status !== "confirmed")
      throw new SettlementError(409, "NOT_CONFIRMED", "확정한 정산만 지급할 수 있습니다.");
    if (s.payoutAmount <= 0)
      throw new SettlementError(409, "NOTHING_TO_PAY", "지급할 금액이 없습니다 (다음 달로 넘김).");
    const [payout] = await tx
      .insert(schema.payouts)
      .values({
        settlementId,
        paidOn: input.paidOn,
        amount: s.payoutAmount,
        recordedBy: input.actorId,
        memo: input.memo.trim(),
      })
      .returning();
    await tx
      .update(schema.settlements)
      .set({ status: "paid", paidAt: now })
      .where(eq(schema.settlements.id, settlementId));
    return { payout: payout!, settlement: s };
  });
}

/** 이의 신청 (강사, 명세 공개 뒤 5일) */
export async function fileObjection(
  db: Db,
  settlementId: string,
  input: { instructorId: string; authorId: string; body: string; now?: Date },
) {
  const now = input.now ?? new Date();
  const body = input.body.trim();
  if (body.length < 5 || body.length > 2000)
    throw new SettlementError(400, "BAD_BODY", "이의 신청 내용을 5 ~ 2,000자로 적어 주세요.");
  const [s] = await db.select().from(schema.settlements).where(eq(schema.settlements.id, settlementId));
  if (!s || s.instructorId !== input.instructorId || s.status === "calculated")
    throw new SettlementError(404, "NOT_FOUND", "정산 명세를 찾을 수 없습니다.");
  if (!canObject(s.publishedAt, now))
    throw new SettlementError(
      409,
      "CLOSED",
      "이의 신청 기간(명세 공개 뒤 5일)이 지났습니다. 1:1 문의로 남겨 주세요.",
    );
  const [open] = await db
    .select({ id: schema.settlementObjections.id })
    .from(schema.settlementObjections)
    .where(and(eq(schema.settlementObjections.settlementId, settlementId), sql`answered_at is null`));
  if (open) throw new SettlementError(409, "OPEN", "답변을 기다리는 이의 신청이 있습니다.");
  const [row] = await db
    .insert(schema.settlementObjections)
    .values({ settlementId, authorId: input.authorId, body, createdAt: now })
    .returning();
  return row!;
}

/**
 * 이의 신청 답변 (운영자). 확정한 정산은 바뀌지 않으므로, 고칠 금액이 있으면 조정으로 남겨 다음에 계산하는 달에 넣는다.
 */
export async function answerObjection(
  db: Db,
  objectionId: string,
  input: { answer: string; adjustment: number; actorId: string; now?: Date },
) {
  const now = input.now ?? new Date();
  const answer = input.answer.trim();
  if (answer.length < 2) throw new SettlementError(400, "BAD_ANSWER", "답변을 적어 주세요.");
  if (!Number.isSafeInteger(input.adjustment))
    throw new SettlementError(400, "BAD_AMOUNT", "조정 금액은 원 단위 정수로 적어 주세요.");
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        objection: schema.settlementObjections,
        settlement: schema.settlements,
        month: schema.settlementPeriods.month,
      })
      .from(schema.settlementObjections)
      .innerJoin(schema.settlements, eq(schema.settlements.id, schema.settlementObjections.settlementId))
      .innerJoin(schema.settlementPeriods, eq(schema.settlementPeriods.id, schema.settlements.periodId))
      .where(eq(schema.settlementObjections.id, objectionId))
      .for("update", { of: schema.settlementObjections });
    if (!row) throw new SettlementError(404, "NOT_FOUND", "이의 신청을 찾을 수 없습니다.");
    if (row.objection.answeredAt) throw new SettlementError(409, "ANSWERED", "이미 답변했습니다.");
    await tx
      .update(schema.settlementObjections)
      .set({ answer, answeredBy: input.actorId, answeredAt: now })
      .where(eq(schema.settlementObjections.id, objectionId));
    let adjustmentId: string | null = null;
    if (input.adjustment !== 0) {
      const [adj] = await tx
        .insert(schema.settlementAdjustments)
        .values({
          instructorId: row.settlement.instructorId,
          amount: input.adjustment,
          reason: `${row.month} 정산 이의 신청 반영`,
          objectionId,
          createdBy: input.actorId,
          createdAt: now,
        })
        .returning({ id: schema.settlementAdjustments.id });
      adjustmentId = adj!.id;
    }
    return { settlement: row.settlement, month: row.month, adjustmentId };
  });
}

/** 운영자 조정 (수수료 정정 등). 다음에 계산하는 달에 한 번 들어간다 */
export async function addAdjustment(
  db: Db,
  input: { instructorId: string; amount: number; reason: string; actorId: string },
) {
  if (!Number.isSafeInteger(input.amount) || input.amount === 0)
    throw new SettlementError(400, "BAD_AMOUNT", "조정 금액은 0 이 아닌 원 단위 정수로 적어 주세요.");
  const reason = input.reason.trim();
  if (reason.length < 2) throw new SettlementError(400, "BAD_REASON", "조정 사유를 적어 주세요.");
  const [row] = await db
    .insert(schema.settlementAdjustments)
    .values({ instructorId: input.instructorId, amount: input.amount, reason, createdBy: input.actorId })
    .returning();
  return row!;
}

/** worker: 매월 2일 새벽, 지난달을 계산한다 (마지막 날 학습 시간 집계가 끝난 뒤). 순서가 맞지 않으면 건너뛴다 */
export async function calculateLastMonth(db: Db, now = new Date()) {
  const month = addMonths(kstMonth(now), -1);
  const block = calculateBlock(month, await periodRows(db), now);
  if (block) return { month, skipped: block };
  const { result } = await calculateMonth(db, month, { now });
  return { month, instructors: result.instructors.length, skippedNoPolicy: result.skippedNoPolicy };
}
