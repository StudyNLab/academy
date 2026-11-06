// 화면 흐름: 홈 상단 Signature (aionit-design v2-2026-11-06) — 로고, 소개 · 실제 링크, 3장면 순환의 장면 단추 · 멈춤,
// '움직임 줄이기' 설정이면 멈춘 채로 시작, 가로 스크롤 없음.
import { expect, test } from "@playwright/test";

const scene = (n: number) => `${["교재와 실습", "학습 과정", "연결된 실무"][n]}:`;

test("홈 상단: 로고 · 소개 · 장면 단추 · 멈춤", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "AIONIT 홈" }).first()).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: /기술을 이해하고/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /배움 시작하기/ })).toHaveAttribute("href", "/courses");
  // 교재 미리보기는 첫 강의의 무료 미리보기 장 (없으면 강의 목록)
  await expect(page.getByRole("link", { name: /교재 미리보기/ })).toHaveAttribute(
    "href",
    /^\/courses(\/[^/]+\/preview\/[^/]+)?$/,
  );
  await expect(
    page.getByRole("region", { name: "학습 분야" }).getByRole("link", { name: /인프라/ }),
  ).toHaveAttribute("href", "/courses?field=infra");

  // 처음은 장면 1, 나머지는 숨김 (접근성 트리에서도)
  await expect(page.getByRole("region", { name: new RegExp(scene(0)) })).toBeVisible();
  await expect(page.getByRole("region", { name: new RegExp(scene(1)) })).toHaveCount(0);

  const pause = page.getByRole("button", { name: "자동 순환 일시정지" });
  await expect(pause).toBeVisible();
  await pause.click();
  await expect(page.getByRole("button", { name: "자동 순환 재생" })).toBeVisible();

  await page.getByRole("button", { name: /이해를 실력으로/ }).click();
  await expect(page.getByRole("button", { name: /이해를 실력으로/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("region", { name: new RegExp(scene(1)) })).toBeVisible();
  await expect(page.getByRole("region", { name: new RegExp(scene(0)) })).toHaveCount(0);

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("홈 상단: 움직임 줄이기면 멈춘 채로 시작, 재생은 고를 수 있음", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const play = page.getByRole("button", { name: "자동 순환 재생" });
  await expect(play).toBeVisible();
  await play.click();
  await expect(page.getByRole("button", { name: "자동 순환 일시정지" })).toBeVisible();
});
