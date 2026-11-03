import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import type { NextConfig } from "next";

// 개발 때는 저장소 루트의 .env 를 읽는다. 서버에서는 컨테이너 환경변수로 받는다.
config({ path: fileURLToPath(new URL("../../.env", import.meta.url)), quiet: true });

const nextConfig: NextConfig = {
  output: "standalone",
  // 같은 폴더에서 개발 서버를 둘 띄울 때(다른 포트) 빌드 폴더가 겹치지 않게
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
  poweredByHeader: false,
  transpilePackages: ["@aionit/ui", "@aionit/core", "@aionit/db", "@aionit/mail"],
  // 네이티브 모듈(argon2) · 작업 대기열은 묶지 않고 node_modules 에서 그대로 불러온다
  serverExternalPackages: ["@node-rs/argon2", "pg-boss"],
  experimental: {
    // 권한 없음(403) 화면: forbidden()
    authInterrupts: true,
  },
};

export default nextConfig;
