// 화면 흐름: 브라우저 표시 영역 (aionit-design 브라우저 브랜딩 요청서) — 탭 제목, 파비콘 링크,
// 주소창 색(meta theme-color)이 시스템 설정 · 직접 고른 테마를 따라 바뀌는지
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

const LIGHT = "#F8F9FC";
const DARK = "#101722";

const themeColors = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map((m) => ({
      media: m.media,
      content: m.content,
    })),
  );

test("탭 제목: 홈은 'AIONIT | 아이오닛', 다른 화면은 '{화면 이름} | AIONIT', 강의 상세는 강의명", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveTitle("AIONIT | 아이오닛");
  await page.goto("/courses");
  await expect(page).toHaveTitle("강의 | AIONIT");
  await page.goto("/login");
  await expect(page).toHaveTitle("로그인 | AIONIT");
  await page.goto("/forgot-password");
  await expect(page).toHaveTitle("비밀번호 찾기 | AIONIT");
  await page.goto("/no-such-page");
  await expect(page).toHaveTitle("페이지를 찾을 수 없음 | AIONIT");

  // 강의 상세는 실제 강의명 (공개 강의가 있을 때)
  await page.goto("/courses");
  const card = page.locator('a[href^="/courses/"]').filter({ hasNotText: /^$/ }).first();
  if ((await card.count()) > 0) {
    await page.goto((await card.getAttribute("href"))!.split("?")[0]!);
    const heading = (await page.getByRole("heading", { level: 1 }).first().innerText()).trim();
    await expect(page).toHaveTitle(`${heading} | AIONIT`);
  }
});

test("파비콘: brand/favicon.svg 의 ON (SVG 먼저, PNG 는 대체)", async ({ page, request }) => {
  await page.goto("/");
  const svg = page.locator('link[rel="icon"][type="image/svg+xml"]');
  await expect(svg).toHaveCount(1);
  const res = await request.get((await svg.getAttribute("href"))!);
  expect(res.ok()).toBe(true);
  expect(await res.text()).toContain('fill="#e23542"');
  await expect(page.locator('link[rel="icon"][type="image/png"]')).toHaveCount(1);
});

test("주소창 색: 시스템 설정을 따르다가, 버튼으로 고르면 그 색 하나로", async ({ page, context }) => {
  await context.clearCookies();
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  // 고른 값이 없으면 운영체제 설정에 따라
  expect(await themeColors(page)).toEqual([
    { media: "(prefers-color-scheme: light)", content: LIGHT },
    { media: "(prefers-color-scheme: dark)", content: DARK },
  ]);

  // 어두운 화면으로 ➔ 그 자리에서 바뀐다
  await page.getByRole("button", { name: "어두운 화면으로" }).first().click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect((await themeColors(page)).map((m) => m.content)).toEqual([DARK, DARK]);
  // 다시 열면 서버가 고른 값 하나만 그린다
  await page.reload();
  expect(await themeColors(page)).toEqual([{ media: "", content: DARK }]);

  // 밝은 화면으로 ➔ 다른 화면으로 옮겨도 그대로
  await page.getByRole("button", { name: "밝은 화면으로" }).first().click();
  expect(await themeColors(page)).toEqual([{ media: "", content: LIGHT }]);
  await page.goto("/courses");
  expect(await themeColors(page)).toEqual([{ media: "", content: LIGHT }]);
});

test("주소창 색: 버튼을 누르기 전에 본 화면으로 뒤로 가도 고른 색 그대로", async ({ page, context }) => {
  await context.clearCookies();
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await page.getByRole("link", { name: /배움 시작하기/ }).click(); // 화면 안에서 옮김 (홈은 고르기 전 상태로 남아 있다)
  await expect(page).toHaveURL(/\/courses$/);
  await page.getByRole("button", { name: "어두운 화면으로" }).first().click();
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(async () => (await themeColors(page)).map((m) => m.content)).toEqual([DARK, DARK]);
});
