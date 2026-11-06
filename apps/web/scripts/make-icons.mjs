// 파비콘 · 앱 아이콘 PNG 를 로고 워드마크의 빨간 ON(src/app/icon.svg = aionit-design v2-2026-11-06 brand/favicon.svg)으로 만든다.
// 디자인 v2 에 앱 아이콘이 따로 없어(범위 밖) 디자이너가 새로 줄 때까지 쓰는 임시본이다.
// 흰 바탕 정사각 안에 ON 을 가운데 둔다. 모서리는 탭 아이콘(64)만 둥글게 — 홈 화면 아이콘은 기기가 깎는다.
//   node apps/web/scripts/make-icons.mjs
// 결과: src/app/icon.png (64) · src/app/apple-icon.png (180) · public/icon-512.png
// 브라우저 탭은 src/app/icon.svg 를 먼저 쓴다 (빨간 ON 한 가지 색, 밝은 · 어두운 탭 모두).
import { chromium } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// favicon.svg 의 ON 경로 (가로 58~130, 세로 0~38) 를 가운데 둔 정사각 viewBox
const symbol = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="42 -33 104 104"><g fill="#e23542">
<path fill-rule="evenodd" d="M69 0h10q11 0 11 11v16q0 11-11 11H69q-11 0-11-11V11Q58 0 69 0Zm1 7q-4 0-4 5v14q0 5 4 5h8q4 0 4-5V12q0-5-4-5Z"/>
<path d="M98 38V0h8l16 25V0h8v38h-8l-16-25v25Z"/></g></svg>`;

function html(size) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:transparent}
#m{width:${size}px;height:${size}px;background:#fff;border-radius:${size === 64 ? 12 : 0}px;display:grid;place-items:center}
#m svg{width:100%;height:100%}
</style></head><body><div id="m">${symbol}</div></body></html>`;
}

// 설치된 Chromium 이 Playwright 가 기대하는 판과 다르면 PLAYWRIGHT_CHROMIUM 에 실행 파일 경로를 준다.
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined });
const page = await browser.newPage({ deviceScaleFactor: 1 });
const targets = [
  [64, join(here, "..", "src", "app", "icon.png")],
  [180, join(here, "..", "src", "app", "apple-icon.png")],
  [512, join(here, "..", "public", "icon-512.png")],
];
for (const [size, out] of targets) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(html(size));
  const png = await page.locator("#m").screenshot({ omitBackground: true });
  await writeFile(out, png);
  console.log(`${size}px → ${out}`);
}
await browser.close();
