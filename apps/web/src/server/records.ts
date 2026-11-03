// 기록 남기기: 로그인 기록 · 관리자 작업 기록 · 개인정보 조회 기록 (모두 덧붙이기만 한다)
import { createHmac } from "node:crypto";
import { normalizeEmail } from "@aionit/core";
import type { Db, LoginResult } from "@aionit/db";
import { and, desc, eq, gt, isNull, schema } from "@aionit/db";

/** 요청한 사람의 IP. Caddy 가 X-Forwarded-For 를 새로 써 주므로 첫 값을 믿는다 (web 은 밖에 직접 열지 않는다). */
export function clientIp(headers: Headers | undefined | null): string | null {
  const forwarded = headers?.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || null;
}

/** 로그인 기록에 이메일 대신 남기는 값. 같은 이메일은 같은 값이 되지만, 비밀키 없이는 이메일로 되돌릴 수 없다. */
export function identifierHash(secret: string, email: string): string {
  return createHmac("sha256", secret)
    .update(`login:${normalizeEmail(email)}`)
    .digest("base64url");
}

export async function isPrivilegedUser(db: Db, userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.userRoles.id })
    .from(schema.userRoles)
    .where(and(eq(schema.userRoles.userId, userId), isNull(schema.userRoles.revokedAt)))
    .limit(1);
  return rows.length > 0;
}

export async function recordLogin(
  db: Db,
  entry: {
    userId: string | null;
    identifierHash?: string | null;
    method: string;
    result: LoginResult;
    headers?: Headers | null;
  },
): Promise<void> {
  const privileged = entry.userId ? await isPrivilegedUser(db, entry.userId) : false;
  await db.insert(schema.loginLogs).values({
    userId: entry.userId,
    identifierHash: entry.identifierHash ?? null,
    method: entry.method,
    result: entry.result,
    ip: clientIp(entry.headers),
    userAgent: entry.headers?.get("user-agent")?.slice(0, 400) ?? null,
    privileged: privileged ? "yes" : "no",
  });
}

/** 마지막 성공 이후의 실패 시각들 (최근 `withinMs` 안). 계정 잠금 판단에 쓴다. */
export async function recentFailures(
  db: Db,
  where: { identifierHash: string } | { userId: string; method: string },
  results: readonly LoginResult[],
  withinMs: number,
  now = new Date(),
): Promise<Date[]> {
  const since = new Date(now.getTime() - withinMs);
  const condition =
    "identifierHash" in where
      ? eq(schema.loginLogs.identifierHash, where.identifierHash)
      : and(eq(schema.loginLogs.userId, where.userId), eq(schema.loginLogs.method, where.method));
  const rows = await db
    .select({ result: schema.loginLogs.result, at: schema.loginLogs.at })
    .from(schema.loginLogs)
    .where(and(condition, gt(schema.loginLogs.at, since)))
    .orderBy(desc(schema.loginLogs.at))
    .limit(200);
  const failures: Date[] = [];
  for (const row of rows) {
    if (row.result === "success") break;
    if (results.includes(row.result)) failures.push(row.at);
  }
  return failures;
}

/** 트랜잭션 안에서도 쓸 수 있게 insert 만 받는다 */
export type Inserter = Pick<Db, "insert">;

export async function writeAudit(
  db: Inserter,
  entry: {
    actorId: string | null;
    action: string;
    targetType?: string;
    targetId?: string;
    before?: unknown;
    after?: unknown;
    headers?: Headers | null;
  },
): Promise<void> {
  await db.insert(schema.auditLogs).values({
    actorId: entry.actorId,
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    ip: clientIp(entry.headers),
  });
}

export async function recordPiiAccess(
  db: Inserter,
  entry: {
    actorId: string;
    subjectUserId: string | null;
    fields: string[];
    purpose: string;
    headers?: Headers | null;
  },
): Promise<void> {
  await db.insert(schema.piiAccessLogs).values({
    actorId: entry.actorId,
    subjectUserId: entry.subjectUserId,
    fields: entry.fields,
    purpose: entry.purpose,
    ip: clientIp(entry.headers),
  });
}
