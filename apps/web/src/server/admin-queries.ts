import "server-only";
import type { Db } from "@aionit/db";
import { and, desc, eq, ilike, ne, or, schema, sql } from "@aionit/db";

/** 목록에서는 이메일을 가린다 (le•••@example.com). 전체 주소는 회원 상세에서만, 조회 기록을 남기고 보인다 */
export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  if (domain.endsWith(".invalid")) return "(이메일 없음)";
  return `${local.slice(0, 2)}${"•".repeat(Math.max(1, Math.min(local.length - 2, 6)))}@${domain}`;
}

const rolesAgg = sql<string[]>`coalesce((
  select array_agg(r.role order by r.role) from user_roles r
  where r.user_id = users.id and r.revoked_at is null), '{}')`; // 하위 쿼리라 users.id 를 직접 쓴다 (열 이름만 쓰면 r.id 로 읽힌다)

export async function searchUsers(db: Db, q: string, limit = 50) {
  const term = q.trim();
  const where = and(
    ne(schema.users.status, "withdrawn"),
    term ? or(ilike(schema.users.email, `%${term}%`), ilike(schema.users.nickname, `%${term}%`)) : undefined,
  );
  return db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      nickname: schema.users.nickname,
      status: schema.users.status,
      emailVerified: schema.users.emailVerified,
      twoFactorEnabled: schema.users.twoFactorEnabled,
      createdAt: schema.users.createdAt,
      roles: rolesAgg,
    })
    .from(schema.users)
    .where(where)
    .orderBy(desc(schema.users.createdAt))
    .limit(limit);
}

export async function userDetail(db: Db, id: string) {
  const [user] = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      nickname: schema.users.nickname,
      status: schema.users.status,
      emailVerified: schema.users.emailVerified,
      twoFactorEnabled: schema.users.twoFactorEnabled,
      createdAt: schema.users.createdAt,
      withdrawnAt: schema.users.withdrawnAt,
      roles: rolesAgg,
    })
    .from(schema.users)
    .where(eq(schema.users.id, id));
  if (!user) return null;
  const accounts = await db
    .select({ providerId: schema.authAccounts.providerId, createdAt: schema.authAccounts.createdAt })
    .from(schema.authAccounts)
    .where(eq(schema.authAccounts.userId, id));
  const logins = await db
    .select()
    .from(schema.loginLogs)
    .where(eq(schema.loginLogs.userId, id))
    .orderBy(desc(schema.loginLogs.at))
    .limit(20);
  const roleHistory = await db
    .select()
    .from(schema.userRoles)
    .where(eq(schema.userRoles.userId, id))
    .orderBy(desc(schema.userRoles.grantedAt));
  return { user, accounts, logins, roleHistory };
}

export async function dashboardCounts(db: Db) {
  const [row] = await db.execute<{
    total: number;
    today: number;
    staff: number;
    failures: number;
    refunds: number;
    sales: number;
    subscribers: number;
    inquiries: number;
    reports: number;
    stale: number;
  }>(sql`
    select
      (select count(*)::int from users where status <> 'withdrawn') as total,
      (select count(*)::int from users where created_at >= date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul') as today,
      (select count(distinct user_id)::int from user_roles where revoked_at is null) as staff,
      (select count(*)::int from login_logs where at > now() - interval '24 hours' and result like 'fail%') as failures,
      (select count(*)::int from refunds where status = 'requested') as refunds,
      (select count(*)::int from subscriptions where status in ('active', 'past_due', 'cancel_scheduled')) as subscribers,
      (select count(*)::int from inquiries where status = 'open') as inquiries,
      (select count(distinct (target_type, target_id))::int from reports where status = 'open') as reports,
      (select count(*)::int from questions where status = 'open' and answer_count = 0 and hidden_at is null
        and deleted_at is null and created_at <= now() - interval '3 days') as stale,
      (select coalesce(sum(total_amount), 0)::bigint::int from orders
        where status in ('paid', 'partially_refunded', 'refunded')
          and paid_at >= date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul') as sales`);
  return row!;
}

export async function recentAudit(db: Db, limit = 100) {
  return db
    .select({
      id: schema.auditLogs.id,
      at: schema.auditLogs.at,
      action: schema.auditLogs.action,
      actorId: schema.auditLogs.actorId,
      actorNickname: sql<string | null>`(select nickname from users u where u.id = audit_logs.actor_id)`,
      targetType: schema.auditLogs.targetType,
      targetId: schema.auditLogs.targetId,
      before: schema.auditLogs.before,
      after: schema.auditLogs.after,
      ip: schema.auditLogs.ip,
    })
    .from(schema.auditLogs)
    .orderBy(desc(schema.auditLogs.at))
    .limit(limit);
}

export async function recentLogins(db: Db, limit = 100) {
  return db
    .select({
      id: schema.loginLogs.id,
      at: schema.loginLogs.at,
      userId: schema.loginLogs.userId,
      nickname: sql<string | null>`(select nickname from users u where u.id = login_logs.user_id)`,
      method: schema.loginLogs.method,
      result: schema.loginLogs.result,
      ip: schema.loginLogs.ip,
      privileged: schema.loginLogs.privileged,
    })
    .from(schema.loginLogs)
    .orderBy(desc(schema.loginLogs.at))
    .limit(limit);
}
