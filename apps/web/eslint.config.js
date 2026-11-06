import base from "@aionit/config/eslint";
import nextPlugin from "@next/eslint-plugin-next";

export default [
  ...base,
  { ignores: ["next-env.d.ts"] },
  {
    // 빌드 도구 스크립트 (Node 로 직접 실행, Playwright 로 브라우저 안 코드도 돌린다)
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        document: "readonly",
        URL: "readonly",
        fetch: "readonly",
        AbortSignal: "readonly",
        setTimeout: "readonly",
      },
    },
    rules: { "no-console": "off" },
  },
  {
    plugins: { "@next/next": nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
    },
  },
];
