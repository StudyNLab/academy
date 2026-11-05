// 화면 흐름: 가입 ➔ 인증 메일 ➔ 로그인 ➔ 로그아웃 ➔ 비밀번호 재설정 ➔ 탈퇴 (개발계획 M1 완료 기준)
// 메일은 개발 VM 의 Mailpit 에서 읽는다 (터널 http://localhost:18025).
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { resetRateLimits } from "./helpers";

const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:18025";

/** 그 주소로 온 가장 최근 메일의 링크 (최대 30초 기다림) */
async function linkFromMail(to: string, subject: string): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const search = await fetch(
      `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}" subject:"${subject}"`)}`,
    );
    const { messages } = (await search.json()) as { messages: { ID: string }[] };
    if (messages.length > 0) {
      const message = (await (await fetch(`${MAILPIT}/api/v1/message/${messages[0]!.ID}`)).json()) as {
        Text: string;
      };
      const url = message.Text.match(/https?:\/\/\S+/)?.[0];
      if (url) return url;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${to} 에게 '${subject}' 메일이 오지 않았습니다`);
}

/** 좁은 화면은 머리글에 회원 메뉴(닉네임 ▾) · 로그인 링크가 없다 (시안). 메뉴 대화상자 안에서 확인한다 */
async function openMobileMenu(page: Page) {
  await page.getByRole("button", { name: /메뉴 열기/ }).click();
  return page.getByRole("dialog");
}

async function expectSignedIn(page: Page, nickname: string, mobile: boolean) {
  // 로그인하면 화면을 새로 연다 (머리글을 로그인 상태로). 그 이동이 끝난 뒤에 확인한다
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  await page.waitForLoadState("load");
  if (!mobile) return expect(page.getByRole("button", { name: nickname })).toBeVisible();
  const menu = await openMobileMenu(page);
  await expect(menu.getByRole("button", { name: "로그아웃" })).toBeVisible();
  await page.keyboard.press("Escape");
}

async function logout(page: Page, nickname: string, mobile: boolean) {
  if (mobile) {
    await (await openMobileMenu(page)).getByRole("button", { name: "로그아웃" }).click();
    await page.waitForLoadState("load");
    await expect(
      (await openMobileMenu(page)).getByRole("link", { name: "로그인", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    return;
  }
  await page.getByRole("button", { name: nickname }).click();
  await page.getByRole("menuitem", { name: "로그아웃" }).click();
  // "로그인 · 보안" 메뉴 글과 헷갈리지 않게 정확히 "로그인"
  await expect(page.getByRole("link", { name: "로그인", exact: true }).first()).toBeVisible();
}

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호", { exact: true }).fill(password);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
}

test("가입 ➔ 메일 인증 ➔ 로그인 ➔ 로그아웃 ➔ 비밀번호 재설정 ➔ 탈퇴", async ({ page }, info) => {
  const stamp = `${Date.now().toString(36)}${info.project.name[0]}`;
  const email = `e2e-${stamp}@example.com`;
  const nickname = `시험${stamp}`.slice(0, 16);
  const password = "Calm-Forest-Engine-31";
  const newPassword = "Bright-Stone-Window-64";
  const mobile = info.project.name === "mobile";

  await resetRateLimits();
  // 가입
  await page.goto("/signup");
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호", { exact: true }).fill(password);
  await page.getByLabel("닉네임").fill(nickname);
  // 필수 동의 없이 누르면 막힌다
  await page.getByRole("button", { name: "이메일로 가입하기" }).click();
  await expect(page.getByText("필수 항목에 동의해야 가입할 수 있습니다.")).toBeVisible();
  await page.getByText("모두 동의합니다").click();
  await page.getByRole("button", { name: "이메일로 가입하기" }).click();
  await expect(page.getByRole("heading", { name: "메일함을 확인해 주세요" })).toBeVisible();

  // 인증 전 로그인은 안 된다
  await login(page, email, password);
  await expect(page.getByText("이메일 인증이 끝나지 않았습니다")).toBeVisible();

  // 메일의 링크 ➔ 로그인 화면
  await page.goto(await linkFromMail(email, "이메일 주소를 확인해 주세요"));
  await expect(page.getByText("이메일 확인이 끝났습니다")).toBeVisible();

  await login(page, email, password);
  await expectSignedIn(page, nickname, mobile);

  // 로그아웃
  await logout(page, nickname, mobile);

  // 비밀번호 재설정
  await page.goto("/forgot-password");
  await page.getByLabel("이메일").fill(email);
  await page.getByRole("button", { name: "재설정 링크 보내기" }).click();
  await expect(page.getByText("메일을 보냈습니다")).toBeVisible();
  await page.goto(await linkFromMail(email, "비밀번호를 다시 정해 주세요"));
  await page.getByLabel("새 비밀번호", { exact: true }).fill(newPassword);
  await page.getByLabel("새 비밀번호 확인").fill(newPassword);
  await page.getByRole("button", { name: "비밀번호 바꾸기" }).click();
  await expect(page.getByText("비밀번호를 바꿨습니다")).toBeVisible();

  await login(page, email, password);
  await expect(page.getByText("이메일 또는 비밀번호가 맞지 않습니다.")).toBeVisible();
  await login(page, email, newPassword);
  await expectSignedIn(page, nickname, mobile);

  // 가로 스크롤이 생기지 않는다
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);

  // 탈퇴 ➔ 같은 비밀번호로 로그인할 수 없다
  await page.goto("/my/withdraw");
  await page.getByLabel("비밀번호", { exact: true }).fill(newPassword);
  await page.getByLabel("확인을 위해").fill("탈퇴합니다");
  await page.getByRole("button", { name: "회원 탈퇴" }).click();
  await expect(page.getByText("탈퇴가 끝났습니다")).toBeVisible();
  await login(page, email, newPassword);
  await expect(page.getByText("이메일 또는 비밀번호가 맞지 않습니다.")).toBeVisible();
});
