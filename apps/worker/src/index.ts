// 작업 처리 (docs/기술설계.md 2.3). M1: 메일 발송, 보관 기간 정리.
import { createDb } from "@aionit/db";
import type { MailJob } from "@aionit/mail";
import { createSmtpMailer, MAIL_QUEUE } from "@aionit/mail";
import { PgBoss } from "pg-boss";
import { sendMailJob } from "./mail";
import { purgeExpiredRecords } from "./retention";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL 이 설정되지 않았습니다");
const smtpUrl = process.env.SMTP_URL;
if (!smtpUrl) throw new Error("SMTP_URL 이 설정되지 않았습니다");

const { db, close } = createDb(url, { max: 4 });
const mailer = createSmtpMailer({
  url: smtpUrl,
  from: process.env.MAIL_FROM ?? "AIONIT <no-reply@aionit.local>",
});

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
  await boss.stop({ graceful: true, timeout: 30_000 });
  await close();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
