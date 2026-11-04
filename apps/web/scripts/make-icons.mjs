// 파비콘 · 앱 아이콘 PNG 를 정사각 마크(SquareMark) 와 같은 모양으로 만든다.
// 글꼴이 있어야 해서 Playwright 의 Chromium 으로 그려 찍는다.
//   node apps/web/scripts/make-icons.mjs
// 결과: src/app/icon.png (64) · src/app/apple-icon.png (180) · public/icon-512.png
import { chromium } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const fontDir = dirname(require.resolve("@fontsource/manrope/800.css"));

async function fontData(file) {
  const buf = await readFile(join(fontDir, "files", file));
  return `url(data:font/woff2;base64,${buf.toString("base64")}) format("woff2")`;
}

const f800 = await fontData("manrope-latin-800-normal.woff2");
const f700 = await fontData("manrope-latin-700-normal.woff2");

function html(size) {
  const small = size < 24;
  const fontSize = small ? size * 0.5 : size * 0.35;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:M;font-weight:800;src:${f800}}
@font-face{font-family:M;font-weight:700;src:${f700}}
html,body{margin:0;background:transparent}
#m{width:${size}px;height:${size}px;background:#18304F;color:#F6F5F1;display:flex;flex-direction:column;align-items:center;justify-content:center;
font-family:M;font-weight:800;font-size:${fontSize}px;line-height:0.86;letter-spacing:${small ? "-0.08em" : "-0.05em"}}
#m i{font-style:normal;font-weight:700;font-size:0.82em;letter-spacing:-0.02em;color:#FF6B5E}
</style></head><body><div id="m"><span>AI</span>${small ? "" : "<i>on</i><span>IT</span>"}</div></body></html>`;
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
  await page.evaluate(() => document.fonts.ready);
  const png = await page.locator("#m").screenshot({ omitBackground: true });
  await writeFile(out, png);
  console.log(`${size}px → ${out}`);
}
await browser.close();
