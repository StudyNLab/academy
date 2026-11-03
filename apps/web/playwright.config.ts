import { defineConfig } from "@playwright/test";

// 화면 흐름 테스트 (docs/기술설계.md 11장). 브라우저를 내려받지 않고 이 PC 의 Chrome 을 쓴다.
// 먼저 띄워 둘 것: `pnpm dev:tunnel`(Mailpit · DB), web 개발 서버, worker (메일 발송)
//   E2E_BASE_URL=http://localhost:3100 pnpm --filter @aionit/web test:e2e
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    channel: "chrome",
    headless: true,
    locale: "ko-KR",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 900 } } },
    { name: "mobile", use: { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true } },
  ],
});
