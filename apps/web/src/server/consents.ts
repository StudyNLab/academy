// 가입 동의 · 만 14세 확인 · 마케팅 수신 동의 (화면 A-01, 데이터모델 3.1 user_consents)
import { checkNickname, NICKNAME_MESSAGES, normalizeNickname } from "@aionit/core";
import type { Db, PolicyKind } from "@aionit/db";
import { and, desc, eq, inArray, lte, schema, sql } from "@aionit/db";
import { z } from "zod";

/** 가입할 때 이메일 · 비밀번호 말고 함께 받는 값. 이메일 가입은 요청 본문으로, 구글 · 카카오는 OAuth state 로 넘어온다. */
export const signupExtrasSchema = z.object({
  nickname: z.string().max(100),
  age14: z.literal(true, { error: "만 14세 이상만 가입할 수 있습니다." }),
  consents: z.object({
    terms: z.literal(true, { error: "이용약관에 동의해야 가입할 수 있습니다." }),
    privacy: z.literal(true, { error: "개인정보 수집 · 이용에 동의해야 가입할 수 있습니다." }),
    marketing: z.boolean(),
  }),
});
export type SignupExtras = z.infer<typeof signupExtrasSchema>;

export type SignupProblem = { code: string; message: string };

/** 가입 입력 검사. 문제가 없으면 정리한 값을, 있으면 첫 문제를 돌려준다. */
export async function validateSignupExtras(
  db: Db,
  input: unknown,
): Promise<{ ok: true; extras: SignupExtras } | { ok: false; problem: SignupProblem }> {
  const parsed = signupExtrasSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, problem: { code: "INVALID_SIGNUP_INPUT", message: parsed.error.issues[0]!.message } };
  }
  const nickname = normalizeNickname(parsed.data.nickname);
  const problem = checkNickname(nickname);
  if (problem)
    return { ok: false, problem: { code: "INVALID_NICKNAME", message: NICKNAME_MESSAGES[problem] } };
  if (await isNicknameTaken(db, nickname)) {
    return { ok: false, problem: { code: "NICKNAME_TAKEN", message: NICKNAME_MESSAGES.taken } };
  }
  return { ok: true, extras: { ...parsed.data, nickname } };
}

export async function isNicknameTaken(db: Db, nickname: string, exceptUserId?: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(sql`lower(${schema.users.nickname}) = lower(${normalizeNickname(nickname)})`)
    .limit(2);
  return rows.some((row) => row.id !== exceptUserId);
}

/** 지금 시행 중인 문서 (종류마다 가장 최근 시행본) */
export async function currentPolicies(db: Db, kinds: PolicyKind[], now = new Date()) {
  const rows = await db
    .select()
    .from(schema.policyDocuments)
    .where(and(inArray(schema.policyDocuments.kind, kinds), lte(schema.policyDocuments.effectiveFrom, now)))
    .orderBy(desc(schema.policyDocuments.effectiveFrom));
  const byKind = new Map<PolicyKind, (typeof rows)[number]>();
  for (const row of rows) if (!byKind.has(row.kind)) byKind.set(row.kind, row);
  return byKind;
}

export async function recordSignupConsents(db: Db, userId: string, extras: SignupExtras, ip: string | null) {
  const policies = await currentPolicies(db, ["terms", "privacy", "marketing"]);
  const answers: [PolicyKind, boolean][] = [
    ["terms", extras.consents.terms],
    ["privacy", extras.consents.privacy],
    ["marketing", extras.consents.marketing],
  ];
  const values = answers.map(([kind, agreed]) => {
    const policy = policies.get(kind);
    if (!policy) throw new Error(`시행 중인 ${kind} 문서가 없습니다`);
    return { userId, policyDocumentId: policy.id, agreed, ip };
  });
  await db.insert(schema.userConsents).values(values);
}

/** 마케팅 수신 동의를 바꾼다 (철회도 새 행으로 남긴다) */
export async function setMarketingConsent(db: Db, userId: string, agreed: boolean, ip: string | null) {
  const policy = (await currentPolicies(db, ["marketing"])).get("marketing");
  if (!policy) throw new Error("시행 중인 마케팅 동의 문서가 없습니다");
  await db.insert(schema.userConsents).values({ userId, policyDocumentId: policy.id, agreed, ip });
}

/** 종류마다 가장 최근 동의 상태 */
export async function latestConsents(db: Db, userId: string) {
  const rows = await db
    .select({
      kind: schema.policyDocuments.kind,
      version: schema.policyDocuments.version,
      agreed: schema.userConsents.agreed,
      at: schema.userConsents.at,
    })
    .from(schema.userConsents)
    .innerJoin(schema.policyDocuments, eq(schema.userConsents.policyDocumentId, schema.policyDocuments.id))
    .where(eq(schema.userConsents.userId, userId))
    .orderBy(desc(schema.userConsents.at), desc(schema.userConsents.id));
  const byKind = new Map<PolicyKind, (typeof rows)[number]>();
  for (const row of rows) if (!byKind.has(row.kind)) byKind.set(row.kind, row);
  return byKind;
}
