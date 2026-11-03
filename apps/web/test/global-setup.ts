// 테스트 DB 에 마이그레이션을 적용한다. TEST_DATABASE_URL 이 없으면 통합 테스트를 할 수 없으므로 멈춘다.
import { applyMigrations } from "@aionit/db/migrator";

export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL 이 없습니다. `pnpm dev:tunnel` 을 열고 .env 를 확인하세요 (README 개발 환경).",
    );
  }
  if (!new URL(url).pathname.endsWith("_test"))
    throw new Error("TEST_DATABASE_URL 은 이름이 _test 로 끝나는 DB 여야 합니다");
  await applyMigrations(url);
}
