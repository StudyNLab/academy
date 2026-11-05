// 파비콘 · 앱 아이콘 PNG 를 로고 심볼(packages/ui/src/Logo.tsx 의 LogoMark, src/app/icon.svg)로 만든다.
// 흰 바탕 정사각 안에 심볼을 가운데 둔다. 모서리는 탭 아이콘(64)만 둥글게 — 홈 화면 아이콘은 기기가 깎는다.
//   node apps/web/scripts/make-icons.mjs
// 결과: src/app/icon.png (64) · src/app/apple-icon.png (180) · public/icon-512.png
// 브라우저 탭은 src/app/icon.svg 를 먼저 쓴다 (다크 탭에서는 밝은 색).
import { chromium } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const symbol = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-8 -8 56 56">
<path d="M4 13 17 0h14L18 13l9 9-7 7z" fill="#1d3048"/><path d="m20 11 16 16-13 13H9l13-13-9-9z" fill="#507cae"/></svg>`;

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
