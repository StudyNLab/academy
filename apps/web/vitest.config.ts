import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { defineConfig } from "vitest/config";

// 통합 테스트는 개발 VM 의 테스트 DB(aionit_test)를 쓴다. 개발 DB 와 섞이지 않게 TEST_DATABASE_URL 만 본다.
config({ path: fileURLToPath(new URL("../../.env", import.meta.url)), quiet: true });

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
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
      BETTER_AUTH_URL: "http://localhost:3000",
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "test-secret-test-secret-test-secret-0000",
    },
  },
});
