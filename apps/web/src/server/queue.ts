import "server-only";
import type { MailJob } from "@aionit/mail";
import { MAIL_QUEUE } from "@aionit/mail";
import { PgBoss } from "pg-boss";
import { getEnv } from "./env";

// web 은 작업을 넣기만 한다 (처리 · 예약 · 정리는 worker). 개발 서버가 코드를 다시 불러도 연결이 하나만 생기게 전역에 둔다.
const globalForQueue = globalThis as unknown as { aionitQueue?: Promise<PgBoss> };

function getQueue(): Promise<PgBoss> {
  if (!globalForQueue.aionitQueue) {
    const boss = new PgBoss({
      connectionString: getEnv().DATABASE_URL,
      schema: "pgboss",
      max: 2,
      supervise: false,
      schedule: false,
    });
    boss.on("error", (error) => console.error("pg-boss 오류 (web)", error));
    globalForQueue.aionitQueue = boss.start().then(async () => {
      // worker 가 먼저 만들었으면 그대로 쓴다. 옵션은 worker 와 같게 (apps/worker/src/index.ts)
      await boss.createQueue(MAIL_QUEUE, {
        retryLimit: 5,
        retryDelay: 30,
        retryBackoff: true,
        deleteAfterSeconds: 3600,
      });
      return boss;
    });
  }
  return globalForQueue.aionitQueue;
}

export async function enqueueMail(job: MailJob): Promise<void> {
  const boss = await getQueue();
  await boss.send(MAIL_QUEUE, job);
}
