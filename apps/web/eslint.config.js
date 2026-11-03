import base from "@aionit/config/eslint";
import nextPlugin from "@next/eslint-plugin-next";

export default [
  ...base,
  { ignores: ["next-env.d.ts"] },
  {
    plugins: { "@next/next": nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
    },
  },
];
