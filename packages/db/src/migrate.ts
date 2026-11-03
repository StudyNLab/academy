// 마이그레이션 적용. 개발: `pnpm db:migrate`, 서버: 배포 때 web 이미지에서 실행한다.
// 되돌리기는 마이그레이션 대신 "배포 전 백업으로 복구" 또는 "고치는 새 마이그레이션"으로 한다.
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./index";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL 이 없습니다");

const { db, close } = createDb(url, { max: 1 });
try {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
  console.warn("마이그레이션 완료");
} finally {
  await close();
}
