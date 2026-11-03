// 마이그레이션 적용. 개발: `pnpm db:migrate`, 서버: 배포 때 web 이미지에서 실행한다.
// 되돌리기는 마이그레이션 대신 "배포 전 백업으로 복구" 또는 "고치는 새 마이그레이션"으로 한다.
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { applyMigrations } from "./migrator";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL 이 없습니다");

await applyMigrations(url);
console.warn("마이그레이션 완료");
