// 작업 처리 (docs/기술설계.md 2.3). M0: 대기열 연결과 상태 확인 작업만 둔다.
import { PgBoss } from "pg-boss";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL 이 설정되지 않았습니다");

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

console.warn("[worker] 시작됨");

async function shutdown(signal: string) {
  console.warn(`[worker] ${signal} 받음, 종료 중`);
  await boss.stop({ graceful: true, timeout: 30_000 });
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
