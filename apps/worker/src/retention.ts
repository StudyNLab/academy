// 보관 기간이 지난 기록 · 끝난 토큰 지우기 (매일). docs/데이터모델.md 4장, docs/기술설계.md 3.3
import { RETENTION } from "@aionit/core";
import type { Db } from "@aionit/db";
import { sql } from "@aionit/db";

const ago = (ms: number, now: Date) => new Date(now.getTime() - ms).toISOString();

export async function purgeExpiredRecords(db: Db, now = new Date()) {
  return db.transaction(async (tx) => {
    // 덧붙이기만 하는 기록 테이블은 이 설정이 있어야 지울 수 있다 (0002 마이그레이션의 트리거)
    await tx.execute(sql`set local aionit.retention_purge = 'on'`);
    const loginMember = await tx.execute(
      sql`delete from login_logs where privileged = 'no' and at < ${ago(RETENTION.loginLogsMemberMs, now)}`,
    );
    const loginPrivileged = await tx.execute(
      sql`delete from login_logs where privileged = 'yes' and at < ${ago(RETENTION.loginLogsPrivilegedMs, now)}`,
    );
    const audit = await tx.execute(sql`delete from audit_logs where at < ${ago(RETENTION.auditLogsMs, now)}`);
    const pii = await tx.execute(
      sql`delete from pii_access_logs where at < ${ago(RETENTION.piiAccessLogsMs, now)}`,
    );
    const nowIso = now.toISOString();
    const sessions = await tx.execute(sql`delete from sessions where expires_at < ${nowIso}`);
    const verifications = await tx.execute(sql`delete from verifications where expires_at < ${nowIso}`);
    // 학습 신호 원자료 (하루 집계는 learning_time_daily 에 남는다)
    const heartbeats = await tx.execute(
      sql`delete from learning_heartbeats where at < ${ago(RETENTION.learningHeartbeatsMs, now)}`,
    );
    // 횟수 제한 카운터는 하루 지나면 의미가 없다
    const rateLimits = await tx.execute(
      sql`delete from rate_limits where last_request < ${now.getTime() - 86_400_000}`,
    );
    return {
      loginLogs: loginMember.count + loginPrivileged.count,
      auditLogs: audit.count,
      piiAccessLogs: pii.count,
      sessions: sessions.count,
      verifications: verifications.count,
      rateLimits: rateLimits.count,
      learningHeartbeats: heartbeats.count,
    };
  });
}
