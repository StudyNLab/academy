// 화면 흐름 테스트(Playwright)를 개발 서버(next dev) 대신 실제 빌드(next build + next start)로 돌린다.
// 개발 서버는 화면을 처음 열 때마다 변환해서 느리고(같은 화면 2~13초 ➔ 실제 빌드 0.1초), 시험 중 코드를 고치면 다시 변환하느라 시간이 넘친다.
//   pnpm --filter @aionit/web test:e2e:build                                   전체 (컴퓨터 · 휴대폰 폭)
//   pnpm --filter @aionit/web test:e2e:build --project=desktop e2e/payment.spec.ts   뒤의 인자는 playwright 에 그대로
// 하는 일: 1. 빌드 (.next-e2e)  2. next start (E2E_PORT, 기본 3800) + worker  3. playwright  4. 서버 · worker 내림
// 먼저 띄워 둘 것: `pnpm dev:tunnel` (DB · S3 · Mailpit). 저장소 루트 .env 를 읽는다.
//   E2E_SKIP_BUILD=1  빌드를 건너뛰고 지난 빌드(.next-e2e)를 띄운다 (테스트만 고쳤을 때)
//   E2E_WORKER=0      worker 를 띄우지 않는다 (이미 떠 있는 worker 가 메일 · 영상 작업을 하게)
// 실제 빌드는 NODE_ENV=production 이라 개발 서버 전용인 가짜 결제(TOSS_FAKE)가 꺼진다. 그래서 빌드할 때 AIONIT_E2E_BUILD=1 을
// 넣어 이 빌드에서만 켠다 (next.config.ts · src/server/payments.ts). 서버 이미지는 이 값 없이 빌드한다.
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const web = fileURLToPath(new URL("../", import.meta.url));
const worker = fileURLToPath(new URL("../../worker/", import.meta.url));
const envFile = fileURLToPath(new URL("../../../.env", import.meta.url));
const distDir = ".next-e2e";
const logDir = fileURLToPath(new URL(`../${distDir}/e2e-logs/`, import.meta.url));
const port = process.env.E2E_PORT ?? "3800";
const baseUrl = `http://localhost:${port}`;
const next = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
const playwright = fileURLToPath(new URL("../node_modules/@playwright/test/cli.js", import.meta.url));

const env = {
  ...process.env,
  NEXT_DIST_DIR: distDir,
  NEXT_TELEMETRY_DISABLED: "1",
  AIONIT_E2E_BUILD: "1",
  TOSS_FAKE: "1",
  // 메일 링크 · 로그인 돌아올 주소 · Origin 확인 기준. http 라 세션 쿠키에 Secure 가 붙지 않는다 (src/server/auth.ts)
  BETTER_AUTH_URL: baseUrl,
};
const args = process.argv.slice(2).filter((arg, i) => !(i === 0 && arg === "--"));
const children = [];
const started = Date.now();
const seconds = (from) => `${Math.round((Date.now() - from) / 1000)}초`;

/** 프로세스와 그 자식까지 내린다 (next start 는 자식 프로세스를 둔다) */
function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32")
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }
}

function stopAll() {
  for (const child of children.reverse()) stop(child);
}

/** 뒤에서 도는 프로세스. 출력은 .next-e2e/e2e-logs/<이름>.log 로 */
function background(name, command, commandArgs, options) {
  const log = createWriteStream(`${logDir}${name}.log`);
  const child = spawn(command, commandArgs, { ...options, detached: process.platform !== "win32" });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  children.push(child);
  console.log(`${name} 띄움: PID ${child.pid} (기록 ${distDir}/e2e-logs/${name}.log)`);
  return child;
}

async function isUp() {
  try {
    await fetch(baseUrl, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!existsSync(envFile)) throw new Error(`저장소 루트에 .env 가 없습니다 (${envFile})`);
  if (await isUp())
    throw new Error(`${baseUrl} 을 이미 다른 프로그램이 쓰고 있습니다. E2E_PORT 로 다른 포트를 주세요`);

  if (process.env.E2E_SKIP_BUILD === "1") console.log(`빌드 건너뜀: 지난 빌드(${distDir})를 씁니다`);
  else {
    const from = Date.now();
    console.log(`1. 빌드 (${distDir}) ...`);
    const build = spawnSync(process.execPath, [next, "build"], { cwd: web, env, stdio: "inherit" });
    if (build.status !== 0) throw new Error("빌드가 실패했습니다");
    console.log(`   빌드 ${seconds(from)}`);
  }

  mkdirSync(logDir, { recursive: true });
  const from = Date.now();
  const server = background("web", process.execPath, [next, "start", "--port", port], { cwd: web, env });
  if (process.env.E2E_WORKER !== "0")
    background("worker", process.execPath, ["--import", "tsx", `--env-file=${envFile}`, "src/index.ts"], {
      cwd: worker,
      env: process.env,
    });
  for (let i = 0; !(await isUp()); i++) {
    if (server.exitCode !== null)
      throw new Error(`web 서버가 바로 꺼졌습니다. ${distDir}/e2e-logs/web.log 를 보세요`);
    if (i >= 60) throw new Error("web 서버가 60초 안에 뜨지 않았습니다");
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log(`2. ${baseUrl} 준비 ${seconds(from)}`);

  const testFrom = Date.now();
  console.log(`3. playwright ${args.join(" ")}`);
  const test = spawnSync(process.execPath, [playwright, "test", ...args], {
    cwd: web,
    env: { ...process.env, E2E_BASE_URL: baseUrl },
    stdio: "inherit",
  });
  console.log(`   playwright ${seconds(testFrom)} (전체 ${seconds(started)})`);
  return test.status ?? 1;
}

process.on("SIGINT", () => {
  stopAll();
  process.exit(130);
});

let code = 1;
try {
  code = await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
} finally {
  stopAll();
  console.log(`4. web 서버 · worker 내림 (PID ${children.map((c) => c.pid).join(", ") || "없음"})`);
}
process.exit(code);
