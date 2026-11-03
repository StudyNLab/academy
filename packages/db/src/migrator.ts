import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./index";

/** 이 패키지의 마이그레이션(../drizzle)을 url 의 DB 에 적용한다 */
export async function applyMigrations(url: string): Promise<void> {
  const { db, close } = createDb(url, { max: 1, quiet: true });
  try {
    await migrate(db, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
  } finally {
    await close();
  }
}
