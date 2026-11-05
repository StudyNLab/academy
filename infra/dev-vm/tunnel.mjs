// 개발 VM(Academy-dev)의 서비스로 SSH 터널을 연다. `pnpm dev:tunnel` 로 실행하고 Ctrl+C 로 닫는다.
// 노트북 쪽 포트는 Windows 가 예약해 둔 범위(`netsh interface ipv4 show excludedportrange protocol=tcp`,
// 2026-11 기준 13816–14015 등)를 피한다. 예약 범위에 걸리면 `bind: Permission denied` 로 터널 전체가 안 열린다.
import { spawn } from "node:child_process";

const forwards = [
  ["15432", "5432", "PostgreSQL"],
  ["23900", "3900", "Garage S3"],
  ["11025", "1025", "Mailpit SMTP"],
  ["18025", "8025", "Mailpit 웹 화면 http://localhost:18025"],
];

const args = [
  "-N",
  "-o",
  "ExitOnForwardFailure=yes",
  "-o",
  "ServerAliveInterval=30",
  "-o",
  "ProxyJump=user1@10.100.4.52",
  "-p",
  "22063",
  ...forwards.flatMap(([local, remote]) => ["-L", `${local}:127.0.0.1:${remote}`]),
  "user1@127.0.0.1",
];

for (const [local, , name] of forwards) console.warn(`localhost:${local}  ➔  ${name}`);
const ssh = spawn("ssh", args, { stdio: "inherit" });
ssh.on("exit", (code) => process.exit(code ?? 0));
