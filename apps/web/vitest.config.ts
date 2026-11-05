import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { defineConfig } from "vitest/config";

// 통합 테스트는 개발 VM 의 테스트 DB 를 쓴다. 개발 DB 와 섞이지 않게 TEST_DATABASE_URL 만 본다.
config({ path: fileURLToPath(new URL("../../.env", import.meta.url)), quiet: true });

// 시험 DB 이름. 여러 작업 창(worktree)이 한 DB 를 같이 쓰면 서로 표를 비워 테스트가 깨지므로 창마다 나눈다.
//   1. TEST_DB_NAME 이 있으면 그 이름
//   2. 저장소가 .claude/worktrees/<이름>/ 아래면 aionit_<이름>_test (예: m8-instructor-eba35f ➔ aionit_m8_instructor_eba35f_test)
//   3. 아니면(본 폴더) TEST_DATABASE_URL 의 이름 그대로 (aionit_test)
// 서버 · 계정 · 비밀번호는 TEST_DATABASE_URL 의 것. 없는 DB 는 test/global-setup.ts 가 만든다.
function testDatabaseUrl(): string {
  const base = process.env.TEST_DATABASE_URL;
  if (!base) return "";
  const url = new URL(base);
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const worktree = root.match(/[\\/]\.claude[\\/]worktrees[\\/]([^\\/]+)/)?.[1];
  if (process.env.TEST_DB_NAME) url.pathname = `/${process.env.TEST_DB_NAME}`;
  else if (worktree) {
    // PostgreSQL 이름은 63바이트까지. 소문자 · 숫자 · _ 만 쓴다
    const slug = worktree
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 63 - "aionit__test".length);
    url.pathname = `/aionit_${slug}_test`;
  }
  return url.toString();
}
process.env.TEST_DATABASE_URL = testDatabaseUrl();

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: fileURLToPath(new URL("./src/", import.meta.url)) },
      { find: "server-only", replacement: fileURLToPath(new URL("./test/empty.ts", import.meta.url)) },
    ],
  },
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    globalSetup: ["./test/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      BETTER_AUTH_URL: "http://localhost:3000",
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "test-secret-test-secret-test-secret-0000",
    },
  },
});
