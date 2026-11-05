// 작업 처리 (docs/기술설계.md 2.3). M1: 메일 발송, 보관 기간 정리. M2: 교재 패키지 처리. M3: 학습 시간 집계. M4: 영상 변환.
// M5: 만료 알림 메일. M6: 구독 자동결제 · 재시도 · 갱신 안내. M9: 월 정산 계산.
import { CONTENT_QUEUE } from "@aionit/content";
import { VIDEO_QUEUE, VIDEO_QUEUE_OPTIONS } from "@aionit/core/media";
import { createDb, eq, schema } from "@aionit/db";
import type { MailJob } from "@aionit/mail";
import { createSmtpMailer, MAIL_QUEUE } from "@aionit/mail";
import { calculateLastMonth, createTossGateway, runSubscriptionBilling } from "@aionit/payments";
import { createS3StoreFromEnv } from "@aionit/storage";
import { PgBoss } from "pg-boss";
import { processCourseVersion } from "./content";
import { aggregateRecentDays } from "./learning";
import { sendMailJob } from "./mail";
import { sendExpiryReminders } from "./reminders";
import { purgeExpiredRecords } from "./retention";
import { transcodeVideo } from "./video";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL 이 설정되지 않았습니다");
const smtpUrl = process.env.SMTP_URL;
if (!smtpUrl) throw new Error("SMTP_URL 이 설정되지 않았습니다");

const { db, close } = createDb(url, { max: 4 });
const mailer = createSmtpMailer({
  url: smtpUrl,
  from: process.env.MAIL_FROM ?? "AIONIT <no-reply@aionit.local>",
});

const store = createS3StoreFromEnv();

const boss = new PgBoss({ connectionString: url, schema: "pgboss" });
boss.on("error", (error) => console.error("pg-boss 오류", error));

await boss.start();

// 상태 확인용: 매시 정각에 한 번 돈다. 대기열이 살아 있는지 확인하는 용도.
const HEARTBEAT = "system.heartbeat";
await boss.createQueue(HEARTBEAT);
await boss.schedule(HEARTBEAT, "0 * * * *", {}, { tz: "Asia/Seoul" });
await boss.work(HEARTBEAT, async () => {
  console.warn(`[worker] heartbeat ${new Date().toISOString()}`);
});

// 메일: 실패하면 30초부터 늘려 가며 5번 다시 시도. 링크(토큰)가 든 작업은 끝나고 1시간 뒤 지운다.
await boss.createQueue(MAIL_QUEUE, {
  retryLimit: 5,
  retryDelay: 30,
  retryBackoff: true,
  deleteAfterSeconds: 3600,
});
await boss.work<MailJob>(MAIL_QUEUE, async (jobs) => {
  for (const job of jobs) await sendMailJob(job.data, { db, mailer });
});

// 교재 패키지 처리. 실패하면 그 버전을 "invalid" 로 두고 이유를 보고서에 남긴다 (운영자가 다시 올린다)
await boss.createQueue(CONTENT_QUEUE, { retryLimit: 0, deleteAfterSeconds: 7 * 86400 });
await boss.work<{ versionId: string }>(CONTENT_QUEUE, async (jobs) => {
  for (const job of jobs) {
    try {
      await processCourseVersion({ db, store }, job.data.versionId);
    } catch (error) {
      console.error(`[worker] 교재 처리 실패 ${job.data.versionId}`, error);
      const message = error instanceof Error ? error.message : String(error);
      await db
        .update(schema.courseVersions)
        .set({
          status: "invalid",
          validationReport: {
            ok: false,
            errors: [{ code: "PROCESS_FAILED", message: `처리 중 오류: ${message.slice(0, 300)}` }],
            warnings: [],
            course: null,
            chapters: [],
            skipped: [],
            diff: null,
          },
        })
        .where(eq(schema.courseVersions.id, job.data.versionId));
    }
  }
});

// 영상 변환 (HLS · AES-128). 한 번에 하나만 (CPU 를 많이 쓴다). worker 를 내리면 변환을 멈추고 다시 대기열로
const media = createS3StoreFromEnv(process.env, "S3_MEDIA_BUCKET");
const secret = process.env.BETTER_AUTH_SECRET;
if (!secret) throw new Error("BETTER_AUTH_SECRET 이 설정되지 않았습니다 (HLS 키 보관에 쓴다)");
const stopping = new AbortController();
await boss.createQueue(VIDEO_QUEUE, VIDEO_QUEUE_OPTIONS);
await boss.work<{ assetId: string }>(VIDEO_QUEUE, { pollingIntervalSeconds: 5 }, async (jobs) => {
  for (const job of jobs) {
    await transcodeVideo({ db, store, media, secret }, job.data.assetId, stopping.signal);
  }
});

// 하루 유효 학습 시간 집계: 매일 00:20 KST (어제 · 그제)
const LEARNING_DAILY = "learning.daily-time";
await boss.createQueue(LEARNING_DAILY);
await boss.schedule(LEARNING_DAILY, "20 0 * * *", {}, { tz: "Asia/Seoul" });
await boss.work(LEARNING_DAILY, async () => {
  const result = await aggregateRecentDays(db);
  console.warn(`[worker] 학습 시간 집계 ${JSON.stringify(result)}`);
});

// 수강 만료 알림 메일 D-30 · D-7: 매일 09:00 KST (M5)
const EXPIRY_REMINDERS = "entitlements.expiry-reminders";
const siteUrl = (process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
await boss.createQueue(EXPIRY_REMINDERS);
await boss.schedule(EXPIRY_REMINDERS, "0 9 * * *", {}, { tz: "Asia/Seoul" });
await boss.work(EXPIRY_REMINDERS, async () => {
  const result = await sendExpiryReminders(db, {
    baseUrl: siteUrl,
    enqueueMail: async (job) => void (await boss.send(MAIL_QUEUE, job)),
  });
  console.warn(`[worker] 만료 알림 ${JSON.stringify(result)}`);
});

// 구독 자동결제: 매일 06:00 KST (해지 예약 끝내기 · 가격 변경 알림 · 갱신 안내 · 결제일 결제 · 실패 재시도).
// 자동결제 키(API 개별 연동)가 없으면 돌리지 않는다
const billingSecret = process.env.TOSS_BILLING_SECRET_KEY;
const SUBSCRIPTION_BILLING = "subscriptions.billing";
await boss.createQueue(SUBSCRIPTION_BILLING, { retryLimit: 0 });
if (billingSecret) {
  const billingGateway = createTossGateway({ secretKey: billingSecret });
  await boss.schedule(SUBSCRIPTION_BILLING, "0 6 * * *", {}, { tz: "Asia/Seoul" });
  await boss.work(SUBSCRIPTION_BILLING, async () => {
    const result = await runSubscriptionBilling({
      db,
      gateway: billingGateway,
      secret,
      baseUrl: siteUrl,
      enqueueMail: async (job) => void (await boss.send(MAIL_QUEUE, job)),
    });
    console.warn(`[worker] 구독 자동결제 ${JSON.stringify(result)}`);
  });
} else {
  await boss.unschedule(SUBSCRIPTION_BILLING);
  console.warn("[worker] TOSS_BILLING_SECRET_KEY 가 없어 구독 자동결제를 돌리지 않습니다");
}

// 월 정산 계산: 매월 2일 05:00 KST. 지난달 마지막 날의 학습 시간은 2일 00:20 집계(늦게 온 신호 포함)에서 끝난다.
// 운영자가 AD-16 에서 검토 · 다시 계산 · 확정한다. 확정하지 않은 앞달이 있으면 건너뛴다
const SETTLEMENT_MONTHLY = "settlements.monthly";
await boss.createQueue(SETTLEMENT_MONTHLY, { retryLimit: 0 });
await boss.schedule(SETTLEMENT_MONTHLY, "0 5 2 * *", {}, { tz: "Asia/Seoul" });
await boss.work(SETTLEMENT_MONTHLY, async () => {
  const result = await calculateLastMonth(db);
  console.warn(`[worker] 월 정산 계산 ${JSON.stringify(result)}`);
});

// 보관 기간 정리: 매일 04:10 KST (DB 백업 03:30 뒤)
const RETENTION_PURGE = "system.retention-purge";
await boss.createQueue(RETENTION_PURGE);
await boss.schedule(RETENTION_PURGE, "10 4 * * *", {}, { tz: "Asia/Seoul" });
await boss.work(RETENTION_PURGE, async () => {
  const result = await purgeExpiredRecords(db);
  console.warn(`[worker] 보관 기간 정리 ${JSON.stringify(result)}`);
});

console.warn("[worker] 시작됨");

async function shutdown(signal: string) {
  console.warn(`[worker] ${signal} 받음, 종료 중`);
  stopping.abort();
  await boss.stop({ graceful: true, timeout: 30_000 });
  await close();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
