// 통합 테스트 DB 이름 정하기. 여러 작업 창(worktree)이 한 DB 를 같이 쓰면 서로 표를 비워 테스트가 깨지므로 창마다 나눈다.
//   1. TEST_DB_NAME 이 있으면 그 이름
//   2. 저장소가 .claude/worktrees/<이름>/ 아래면 aionit_<이름>_test (예: m8-instructor-eba35f ➔ aionit_m8_instructor_eba35f_test)
//   3. 아니면(본 폴더) TEST_DATABASE_URL 의 이름 그대로 (aionit_test)
// 서버 · 계정 · 비밀번호는 TEST_DATABASE_URL 의 것을 쓴다.
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

export function testDatabaseName(
  baseUrl: string,
  env: NodeJS.ProcessEnv = process.env,
  root = REPO_ROOT,
): string {
  if (env.TEST_DB_NAME) return env.TEST_DB_NAME;
  const worktree = root.match(/[\\/]\.claude[\\/]worktrees[\\/]([^\\/]+)/)?.[1];
  if (!worktree) return decodeURIComponent(new URL(baseUrl).pathname.slice(1));
  // PostgreSQL 이름은 63바이트까지. 소문자 · 숫자 · _ 만 쓴다
  const slug = worktree
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 63 - "aionit__test".length);
  return `aionit_${slug}_test`;
}

/** TEST_DATABASE_URL 에서 DB 이름만 이 창의 것으로 바꾼 주소. TEST_DATABASE_URL 이 없으면 빈 문자열 */
export function testDatabaseUrl(env: NodeJS.ProcessEnv = process.env, root = REPO_ROOT): string {
  const base = env.TEST_DATABASE_URL;
  if (!base) return "";
  const url = new URL(base);
  url.pathname = `/${testDatabaseName(base, env, root)}`;
  return url.toString();
}
