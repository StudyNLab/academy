// 보관 기간이 지난 기록 · 끝난 토큰 지우기 (매일). docs/데이터모델.md 4장, docs/기술설계.md 3.3
import { RETENTION } from "@aionit/core";
import type { Db } from "@aionit/db";
import { sql } from "@aionit/db";

const ago = (ms: number, now: Date) => new Date(now.getTime() - ms).toISOString();

export async function purgeExpiredRecords(db: Db, now = new Date()) {
  return db.transaction(async (tx) => {
    // 기록 테이블(로그인 · 운영자 작업 · 개인정보 조회 기록, 1:1 문의)은 앱 계정에 지울 권한이 없다.
    // 소유자 권한 함수가 DB 시각 기준으로만 지운다 (0012 마이그레이션). 그래서 `now` 를 넘겨도 이 넷은 앞당겨지지 않는다
    const [row] = await tx.execute<{ purged: Record<string, number> }>(
      sql`select aionit_purge_protected_records() as purged`,
    );
    const protectedCounts = row!.purged;
    const nowIso = now.toISOString();
    const sessions = await tx.execute(sql`delete from sessions where expires_at < ${nowIso}`);
    const verifications = await tx.execute(sql`delete from verifications where expires_at < ${nowIso}`);
    // 학습 신호 원자료 (하루 집계는 learning_time_daily 에 남는다)
    const heartbeats = await tx.execute(
      sql`delete from learning_heartbeats where at < ${ago(RETENTION.learningHeartbeatsMs, now)}`,
    );
    // 사이트 알림: 읽은 것 90일, 읽지 않은 것도 1년
    const notifications = await tx.execute(
      sql`delete from notifications where (read_at is not null and created_at < ${ago(RETENTION.notificationsReadMs, now)})
          or created_at < ${ago(RETENTION.notificationsMs, now)}`,
    );
    // 횟수 제한 카운터는 하루 지나면 의미가 없다
    const rateLimits = await tx.execute(
      sql`delete from rate_limits where last_request < ${now.getTime() - 86_400_000}`,
    );
    return {
      loginLogs: protectedCounts.loginLogs ?? 0,
      auditLogs: protectedCounts.auditLogs ?? 0,
      piiAccessLogs: protectedCounts.piiAccessLogs ?? 0,
      sessions: sessions.count,
      verifications: verifications.count,
      rateLimits: rateLimits.count,
      learningHeartbeats: heartbeats.count,
      notifications: notifications.count,
      inquiries: protectedCounts.inquiries ?? 0,
    };
  });
}
