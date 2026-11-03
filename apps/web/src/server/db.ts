import "server-only";
import { createDb } from "@aionit/db";

// 개발 서버의 코드 다시 불러오기 때문에 연결이 여러 개 생기지 않도록 전역에 하나만 둔다.
const globalForDb = globalThis as unknown as { aionitDb?: ReturnType<typeof createDb> };

export function getDb() {
  if (!globalForDb.aionitDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL 이 설정되지 않았습니다");
    globalForDb.aionitDb = createDb(url);
  }
  return globalForDb.aionitDb.db;
}
