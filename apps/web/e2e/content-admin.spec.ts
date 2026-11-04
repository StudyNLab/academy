// 화면 흐름 (M2): 운영자(2단계 인증) ➔ 과정 등록 ➔ 교재 패키지 올리기 ➔ 검수 ➔ 공개 ➔ 영상 연결 · 무료 미리보기 ➔
// 공개 화면(홈 · 강의 목록 · 상세 · 미리보기). 패키지는 E2E_PACKAGE(zip 경로)가 있으면 그것을, 없으면 시험 패키지를 만든다.
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { buildZip, normalEntries } from "../../../packages/content/test/fixtures";
import { grantOperator, login, resetRateLimits, signUpVerified, totp } from "./helpers";

test.describe.configure({ mode: "serial" });

test("운영자가 교재를 올려 검수 · 공개하면 강의 목록 · 상세 · 무료 미리보기에 보인다", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "관리 화면 흐름은 데스크톱에서 한 번만");
  test.setTimeout(240_000);
  const stamp = Date.now().toString(36);
  const email = `e2e-op-${stamp}@example.com`;
  const password = "Calm-Forest-Engine-31";

  // 시험 패키지: course_id 를 실행마다 다르게
  const slug = process.env.E2E_PACKAGE ? "ai-agent-basics" : `e2e-${stamp}`;
  let packagePath = process.env.E2E_PACKAGE;
  if (!packagePath) {
    const entries = (await normalEntries()).map((e) =>
      e.name === "course.json"
        ? { ...e, data: (e.data as string).replace('"ai-agent-basics"', `"${slug}"`) }
        : e,
    );
    const dir = join(tmpdir(), "aionit-e2e");
    mkdirSync(dir, { recursive: true });
    packagePath = join(dir, `${slug}.zip`);
    writeFileSync(packagePath, buildZip(entries));
  }

  // 1. 운영자 준비: 가입 ➔ 역할 ➔ 로그인 ➔ 2단계 인증 켜기
  await resetRateLimits();
  await signUpVerified(page, email, password, `운영${stamp}`.slice(0, 16).replace("운영", "op"));
  await grantOperator(email);
  await login(page, email, password);
  await page.waitForURL((url) => url.pathname === "/");
  await page.goto("/admin/courses");
  await expect(page).toHaveURL(/\/my\/security\?required=1/);
  await page.getByLabel("비밀번호 확인").fill(password);
  await page.getByRole("button", { name: "2단계 인증 켜기" }).click();
  const secret = (await page.locator("code").first().textContent())!.trim();
  await page.getByLabel("인증 코드 (6자리)").fill(totp(secret));
  await page.getByRole("button", { name: "확인하고 켜기" }).click();
  await expect(page.getByText("복구 코드 — 지금 안전한 곳에 적어 두세요")).toBeVisible();
  await page.getByRole("button", { name: "하던 일로 돌아가기" }).click();
  await expect(page.getByRole("heading", { name: "과정", exact: true })).toBeVisible();

  // 잘못 만든 강사는 아래 강사 목록에서 지운다 (맡은 과정이 없을 때만)
  const typo = `오타강사${stamp}`.slice(0, 20);
  await page.getByLabel("강사가 목록에 없으면 새로 추가").fill(typo);
  await page.getByRole("button", { name: "강사 추가" }).click();
  const typoRow = page.getByRole("listitem").filter({ hasText: typo });
  await expect(typoRow).toBeVisible();
  page.once("dialog", (dialog) => void dialog.accept());
  await typoRow.getByRole("button", { name: "지우기" }).click();
  await expect(typoRow).toHaveCount(0);

  // 2. 과정 등록 (강사 추가 포함)
  await page.getByLabel("과정 ID").fill(slug);
  await page.getByLabel("과정 이름").fill(`AI Agent 개발 · 초급 ${stamp}`);
  await page.getByLabel("수준").fill("초급");
  await page.getByLabel("한 줄 소개").fill("LLM API 로 나만의 Agent 를 만든다");
  await page.getByLabel("강사가 목록에 없으면 새로 추가").fill(`홍길동${stamp}`.slice(0, 20));
  await page.getByRole("button", { name: "강사 추가" }).click();
  await expect(page.getByLabel("소유 강사")).not.toHaveValue("");
  await page.getByRole("button", { name: "과정 등록" }).click();
  await expect(page.getByText(`Course · ${slug}`, { exact: false })).toBeVisible();

  // 3. 패키지 올리기 ➔ 검사 (worker) ➔ 검수 대기
  await page.getByLabel(/zip 파일 \(course_id/).setInputFiles(packagePath);
  await page.getByRole("button", { name: "올리기", exact: true }).click();
  await expect(page.getByText("구조 · 허용 목록 · 그림 검사 통과")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("검수 대기")).toBeVisible();
  await expect(page.getByText(/영상 자리 \d+개가 아직 연결되지 않았습니다/)).toBeVisible();

  // 운영자 미리보기: 그림이 우리 주소로, 연결 안 된 영상 자리는 "영상 연결 필요"
  await page.getByRole("link", { name: /ch01/ }).first().click();
  await expect(page.locator(".reader img").first()).toBeVisible();
  const firstImg = page.locator(".reader img").first();
  const src = (await firstImg.getAttribute("src"))!;
  const response = await page.request.get(src);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("image/webp");
  await firstImg.scrollIntoViewIfNeeded();
  await expect.poll(() => firstImg.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  if (!process.env.E2E_PACKAGE) await expect(page.getByText("영상 연결 필요").first()).toBeVisible();
  await page.goBack();

  // 4. 승인하고 공개
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "승인하고 공개" }).click();
  await expect(page.getByText("공개 중")).toBeVisible();

  // 5. 영상 연결 (첫 챕터 영상) · 무료 미리보기 (ch01 전체)
  const firstSlot = page.locator("form", { hasText: "ch01_main" });
  await firstSlot.getByRole("textbox").fill("https://youtu.be/dQw4w9WgXcQ");
  await firstSlot.getByRole("button", { name: "연결", exact: true }).click();
  await expect(firstSlot.getByRole("button", { name: "끊기", exact: true })).toBeVisible();
  await page.getByLabel("미리보기 범위").first().selectOption("whole");
  await page.getByRole("button", { name: "저장", exact: true }).first().click();
  await expect(page.getByText("저장했습니다.").first()).toBeVisible();

  // 6. 공개 화면: 목록 ➔ 상세 ➔ 무료 미리보기 (로그인 없이)
  await page.context().clearCookies();
  await page.goto("/courses");
  await page.getByRole("link", { name: new RegExp(`AI Agent 개발 · 초급 ${stamp}`) }).click();
  await expect(page.getByRole("heading", { name: `AI Agent 개발 · 초급 ${stamp}` })).toBeVisible();
  await expect(
    page.locator('iframe[src^="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"]').first(),
  ).toBeAttached();
  await page.getByRole("link", { name: "무료 미리보기" }).first().click();
  await expect(page.getByText("무료 미리보기").first()).toBeVisible();
  await expect(page.locator(".reader section.sec").first()).toBeVisible();
  // 미리보기로 열지 않은 챕터는 볼 수 없다
  const blocked = await page.request.get(`/courses/${slug}/preview/ch02`);
  expect(blocked.status()).toBe(404);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});
