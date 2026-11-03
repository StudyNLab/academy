import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import type { NextConfig } from "next";

// 개발 때는 저장소 루트의 .env 를 읽는다. 서버에서는 컨테이너 환경변수로 받는다.
config({ path: fileURLToPath(new URL("../../.env", import.meta.url)), quiet: true });

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
  poweredByHeader: false,
  transpilePackages: ["@aionit/ui", "@aionit/core", "@aionit/db"],
};

export default nextConfig;
