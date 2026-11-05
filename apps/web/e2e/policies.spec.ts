// 화면 흐름 (M10): 정책 문서 관리(AD-12) ➔ 새 버전 시행 예정 ➔ 공개 화면 안내 · 모든 버전 ➔ 지우기,
// 바닥글 사업자 정보 · 개인정보처리방침 링크, 탈퇴 화면 안내, 375px 가로 스크롤 없음.
// 개발 DB 를 같이 쓰므로 이 시험이 만든 시행 예정 버전은 화면에서 지운다 (실패하면 끝에 DB 에서).
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { createDb, schema, sql } from "@aionit/db";
import { grantOperator, login, resetRateLimits, signUpVerified, totp } from "./helpers";

test.describe.configure({ mode: "serial" });

async function setupTwoFactor(page: Page, password: string) {
  await expect(page).toHaveURL(/\/my\/security\?required=1/);
  await page.getByLabel("비밀번호 확인").fill(password);
  await page.getByRole("button", { name: "2단계 인증 켜기" }).click();
  const secret = (await page.locator("code").first().textContent())!.trim();
  await page.getByLabel("인증 코드 (6자리)").fill(totp(secret));
  await page.getByRole("button", { name: "확인하고 켜기" }).click();
  await expect(page.getByText("복구 코드 — 지금 안전한 곳에 적어 두세요")).toBeVisible();
  await page.getByRole("button", { name: "하던 일로 돌아가기" }).click();
}

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

async function shoot(page: Page, name: string) {
  const dir = process.env.E2E_SCREENSHOTS;
  if (!dir) return;
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.screenshot({ path: `${dir}/${name}-${scheme}.png`, fullPage: true });
  }
  await page.emulateMedia({ colorScheme: "light" });
}

const stamp = Date.now().toString(36);
const version = `e2e-${stamp}`;

test.afterAll(async () => {
  const { db, close } = createDb(process.env.DATABASE_URL!, { max: 1, quiet: true });
  try {
    await db.delete(schema.policyDocuments).where(sql`${schema.policyDocuments.version} = ${version}`);
  } finally {
    await close();
  }
});

test("운영자가 정책 문서 새 버전을 시행일과 함께 올리면 공개 화면에 시행 예정으로 보이고, 시행 전에 지울 수 있다", async ({
  browser,
}, info) => {
  test.skip(info.project.name !== "desktop", "관리 화면 흐름은 데스크톱에서 한 번만 (끝에서 375px 도 본다)");
  test.setTimeout(240_000);
  const opEmail = `e2e-policy-${stamp}@example.com`;
  const password = "Calm-Forest-Engine-31";
  const op = await (await browser.newContext()).newPage();
  op.on("dialog", (dialog) => void dialog.accept());
  await resetRateLimits();
  await signUpVerified(op, opEmail, password, `pol${stamp}`.slice(0, 16));
  await grantOperator(opEmail);
  await login(op, opEmail, password);
  await op.waitForURL((url) => url.pathname === "/");

  // 1. 관리 목록: 종류마다 시행 중 · 시행 예정
  await op.goto("/admin/policies");
  await setupTwoFactor(op, password);
  await expect(op.getByRole("heading", { name: "정책 문서" })).toBeVisible();
  await expect(op.getByRole("link", { name: "개인정보처리방침" })).toBeVisible();
  await expect(op.getByRole("link", { name: "정책 문서" }).first()).toBeVisible(); // 관리자 메뉴
  await shoot(op, "admin-policies");

  // 2. 이용약관 화면: 모든 버전 + 새 버전 (가장 이른 시행일이 먼저 들어 있다)
  await op.getByRole("link", { name: "이용약관", exact: true }).click();
  await expect(op.getByRole("heading", { name: "이용약관", exact: true })).toBeVisible();
  const date = op.getByLabel("시행일 (이날 0시, 한국 시각)");
  const earliest = await date.inputValue();
  expect(earliest).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await op.getByLabel("버전 이름").fill(version);
  await op.getByLabel("내용").fill("## 제1조 (목적)\n\n화면 흐름 시험으로 올린 시행 예정 버전입니다.");
  // 불리한 변경을 고르면 30일 뒤로 밀린다
  await op.getByText("회원(강사)에게 불리한 변경").click();
  expect(await date.inputValue()).not.toBe(earliest);
  await op.getByText("회원(강사)에게 불리한 변경").click();
  await date.fill("2099-01-01");
  await op.getByRole("button", { name: "새 버전 게시" }).click();
  await expect(op.getByText("게시했습니다.")).toBeVisible();
  await expect(op.getByRole("link", { name: version })).toBeVisible();
  await expect(op.getByText("시행 예정").first()).toBeVisible();
  await shoot(op, "admin-policy-terms");

  // 3. 공개 화면: 지금 버전 + 가장 가까운 시행 예정 버전 안내 + 모든 버전 (방금 올린 버전도 시행 예정으로)
  await op.goto("/policies/terms");
  await expect(op.getByText(/부터 바뀝니다\./)).toBeVisible();
  await expect(op.getByRole("heading", { name: "모든 버전" })).toBeVisible();
  const mine = op.getByRole("listitem").filter({ hasText: version });
  await expect(mine).toContainText("2099. 1. 1. 시행 · 시행 예정");
  await mine.getByRole("link", { name: version }).click();
  await expect(op.getByText("2099. 1. 1. 부터 시행할 버전입니다.")).toBeVisible();
  await expect(op.getByRole("heading", { name: "제1조 (목적)" })).toBeVisible();
  await shoot(op, "public-policy-scheduled");

  // 4. 바닥글: 사업자 정보 줄 · 개인정보처리방침
  await op.getByRole("link", { name: "개인정보처리방침" }).last().click();
  await expect(op).toHaveURL(/\/policies\/privacy_policy/);
  await expect(op.getByRole("heading", { name: "개인정보처리방침" })).toBeVisible();
  await expect(op.getByRole("contentinfo").getByText(/사업자등록번호 .* 통신판매업 신고/)).toBeVisible();

  // 5. 시행 전 버전 지우기
  await op.goto("/admin/policies/terms");
  await op.getByRole("row").filter({ hasText: version }).getByRole("button", { name: "지우기" }).click();
  await expect(op.getByRole("link", { name: version })).toHaveCount(0);

  // 6. 탈퇴 화면 안내 (1:1 문의 3년)
  await op.goto("/my/withdraw");
  await expect(
    op.getByText("1:1 문의는 분쟁 해결을 위해 마지막 글부터 3년 보관한 뒤 지웁니다."),
  ).toBeVisible();

  // 7. 375px
  await op.setViewportSize({ width: 375, height: 812 });
  for (const path of [
    "/admin/policies",
    "/admin/policies/terms",
    "/policies/terms",
    "/policies/privacy_policy",
  ]) {
    await op.goto(path);
    expect(await noHorizontalScroll(op), `${path} 가로 스크롤`).toBe(true);
  }
  await shoot(op, "public-policy-375");
});
