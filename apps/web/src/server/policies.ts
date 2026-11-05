// 정책 문서 버전 · 시행일 관리 (AD-12 의 정책 문서, M10). 공개 화면 P-09 의 지난 버전 · 시행 예정 안내.
// 정책 문서는 고치지 않고 새 버전을 만든다. 시행 전 버전만 지울 수 있다 (DB 트리거도 막는다, 마이그레이션 0013).
// 운영자 작업은 audit_logs 에 남긴다.
import { kstDate } from "@aionit/core";
import type { Db, PolicyKind } from "@aionit/db";
import { and, asc, desc, eq, POLICY_KINDS, schema } from "@aionit/db";
import { z } from "zod";
import { writeAudit } from "./records";
import { SupportError } from "./support-error";

export const POLICY_LABELS: Record<PolicyKind, string> = {
  terms: "이용약관",
  privacy: "개인정보 수집 · 이용 동의",
  privacy_policy: "개인정보처리방침",
  marketing: "마케팅 정보 수신 동의",
  refund: "환불 정책",
  instructor_terms: "강사 이용약관",
};

/** 가입할 때 꼭 동의해야 하나 (종류마다 정해져 있다) */
const REQUIRED: Record<PolicyKind, boolean> = {
  terms: true,
  privacy: true,
  privacy_policy: false,
  marketing: false,
  refund: false,
  instructor_terms: false,
};

/**
 * 시행일까지 최소 며칠 알리나. 이용약관 제3조: 7일 전, 회원(강사)에게 불리한 변경은 30일 전.
 * 마케팅 수신 동의는 선택 동의라 내일부터
 */
const NOTICE_DAYS: Record<PolicyKind, number> = {
  terms: 7,
  privacy: 7,
  privacy_policy: 7,
  marketing: 1,
  refund: 7,
  instructor_terms: 7,
};
export const ADVERSE_NOTICE_DAYS = 30;

export type PolicyState = "current" | "scheduled" | "past";

export function isPolicyKind(value: string): value is PolicyKind {
  return (POLICY_KINDS as readonly string[]).includes(value);
}

const kstStart = (day: string) => new Date(`${day}T00:00:00+09:00`);

/** 오늘(KST)부터 days 일 뒤의 날짜 'YYYY-MM-DD' */
export function earliestEffectiveOn(kind: PolicyKind, adverse: boolean, now = new Date()): string {
  const days = adverse ? ADVERSE_NOTICE_DAYS : NOTICE_DAYS[kind];
  return kstDate(new Date(kstStart(kstDate(now)).getTime() + days * 86_400_000));
}

/** 한 종류의 모든 버전 (최근 시행일부터) + 상태 */
export async function policyHistory(db: Db, kind: PolicyKind, now = new Date()) {
  const rows = await db
    .select()
    .from(schema.policyDocuments)
    .where(eq(schema.policyDocuments.kind, kind))
    .orderBy(desc(schema.policyDocuments.effectiveFrom), desc(schema.policyDocuments.createdAt));
  let currentSeen = false;
  return rows.map((row) => {
    let state: PolicyState;
    if (row.effectiveFrom > now) state = "scheduled";
    else if (!currentSeen) {
      state = "current";
      currentSeen = true;
    } else state = "past";
    return { ...row, state };
  });
}

/** 종류마다 지금 시행 중 · 다음 시행 예정 · 버전 수 (관리 목록) */
export async function policyOverview(db: Db, now = new Date()) {
  const rows = await db
    .select()
    .from(schema.policyDocuments)
    .orderBy(asc(schema.policyDocuments.effectiveFrom));
  return POLICY_KINDS.map((kind) => {
    const mine = rows.filter((r) => r.kind === kind);
    const current = mine.filter((r) => r.effectiveFrom <= now).at(-1) ?? null;
    const next = mine.find((r) => r.effectiveFrom > now) ?? null;
    return { kind, label: POLICY_LABELS[kind], current, next, count: mine.length };
  });
}

export const policyInput = z.object({
  kind: z.enum(POLICY_KINDS),
  version: z
    .string()
    .trim()
    .regex(/^[0-9A-Za-z][0-9A-Za-z.-]{0,39}$/, {
      error: "버전은 영문 · 숫자 · 점 · 하이픈 40자까지 (예: 2026-12-01)",
    }),
  title: z.string().trim().min(2, { error: "제목을 적어 주세요." }).max(100),
  bodyMd: z.string().trim().min(10, { error: "내용을 적어 주세요." }).max(100_000),
  effectiveOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: "시행일을 확인해 주세요." }),
  /** 회원(강사)에게 불리한 변경 ➔ 30일 전에 알린다 */
  adverse: z.boolean(),
});
export type PolicyInput = z.infer<typeof policyInput>;

/** 새 버전. 시행일은 알릴 기간 뒤부터, 같은 종류 같은 시행일은 하나만 */
export async function createPolicyVersion(
  db: Db,
  input: PolicyInput & { actorId: string; headers?: Headers | null },
  now = new Date(),
) {
  const earliest = earliestEffectiveOn(input.kind, input.adverse, now);
  if (input.effectiveOn < earliest)
    throw new SupportError(
      400,
      "TOO_SOON",
      `${POLICY_LABELS[input.kind]}${input.adverse ? "의 불리한 변경" : ""}은 ${earliest} 부터 시행할 수 있습니다 (미리 알릴 기간).`,
    );
  const effectiveFrom = kstStart(input.effectiveOn);
  const existing = await db
    .select({ version: schema.policyDocuments.version, effectiveFrom: schema.policyDocuments.effectiveFrom })
    .from(schema.policyDocuments)
    .where(eq(schema.policyDocuments.kind, input.kind));
  if (existing.some((r) => r.version === input.version))
    throw new SupportError(409, "VERSION_TAKEN", "같은 버전 이름이 이미 있습니다.");
  if (existing.some((r) => r.effectiveFrom.getTime() === effectiveFrom.getTime()))
    throw new SupportError(
      409,
      "SAME_DAY",
      "같은 날 시행하는 버전이 이미 있습니다. 그 버전을 지우고 다시 만드세요.",
    );
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.policyDocuments)
      .values({
        kind: input.kind,
        version: input.version,
        title: input.title,
        bodyMd: input.bodyMd,
        required: REQUIRED[input.kind],
        effectiveFrom,
      })
      .returning();
    await writeAudit(tx, {
      actorId: input.actorId,
      action: "policy.create",
      targetType: "policy_document",
      targetId: row!.id,
      after: {
        kind: row!.kind,
        version: row!.version,
        effectiveFrom: input.effectiveOn,
        adverse: input.adverse,
      },
      headers: input.headers,
    });
    return row!;
  });
}

/** 시행 전 버전 지우기 (시행된 버전 · 동의 기록이 가리키는 버전은 안 된다) */
export async function deletePolicyVersion(
  db: Db,
  input: { id: string; actorId: string; headers?: Headers | null },
  now = new Date(),
) {
  const [row] = await db.select().from(schema.policyDocuments).where(eq(schema.policyDocuments.id, input.id));
  if (!row) throw new SupportError(404, "NOT_FOUND", "정책 문서를 찾을 수 없습니다.");
  if (row.effectiveFrom <= now)
    throw new SupportError(409, "IN_FORCE", "시행된 버전은 지울 수 없습니다. 새 버전을 만드세요.");
  await db.transaction(async (tx) => {
    await tx
      .delete(schema.policyDocuments)
      .where(and(eq(schema.policyDocuments.id, row.id)))
      .catch((error: unknown) => {
        if ((error as { cause?: { code?: string } }).cause?.code === "23503")
          throw new SupportError(409, "IN_USE", "이 버전에 동의한 기록이 있어 지울 수 없습니다.");
        throw error;
      });
    await writeAudit(tx, {
      actorId: input.actorId,
      action: "policy.delete",
      targetType: "policy_document",
      targetId: row.id,
      before: { kind: row.kind, version: row.version, effectiveFrom: kstDate(row.effectiveFrom) },
      headers: input.headers,
    });
  });
}
