// 테스트 DB 를 (없으면 만들고) 마이그레이션을 적용한다. TEST_DATABASE_URL 이 없으면 통합 테스트를 할 수 없으므로 멈춘다.
// TEST_DATABASE_URL 은 vitest.config.ts 가 이 창의 DB 이름으로 바꿔 둔 것이다.
import { createDb, sql } from "@aionit/db";
import { applyMigrations } from "@aionit/db/migrator";

export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL 이 없습니다. `pnpm dev:tunnel` 을 열고 .env 를 확인하세요 (README 개발 환경).",
    );
  }
  const name = decodeURIComponent(new URL(url).pathname.slice(1));
  if (!/^[a-z0-9_]+_test$/.test(name))
    throw new Error(`시험 DB 이름은 소문자 · 숫자 · _ 로, _test 로 끝나야 합니다: ${name}`);
  await createIfMissing(url, name);
  console.warn(`통합 테스트 DB: ${name}`); // 어느 DB 인지 늘 보이게 (log 는 린트가 막음)
  await applyMigrations(url);
}

async function createIfMissing(url: string, name: string) {
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const { db, close } = createDb(admin.toString(), { max: 1, quiet: true });
  try {
    const found = await db.execute(sql`select 1 from pg_database where datname = ${name}`);
    if (found.length > 0) return;
    await db.execute(sql.raw(`create database "${name}"`)).catch((e: { code?: string }) => {
      if (e.code !== "42P04") throw e; // 다른 실행이 막 만든 경우
    });
  } finally {
    await close();
  }
}
