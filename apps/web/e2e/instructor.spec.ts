// 화면 흐름 (M8): 운영자가 강사 등록 · 계약 ➔ 강사 2단계 인증 · 계약 동의 · 공개 프로필 ➔ 과정 만들기 ➔ 교재 올리기 ➔
// 검수 요청 ➔ 운영자 반려(사유) ➔ 강사 화면 · 사이트 알림 · 메일(대기열) 에 사유 ➔ 다시 요청 ➔ 공개 ➔ 강의 상세 강사 소개 ·
// 강사 소개 화면 ➔ 판매 · 수강 현황 · Q&A ➔ 남의 화면(관리자 · 남의 과정)은 막힘 ➔ 375px 가로 스크롤 없음
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { createDb, sql } from "@aionit/db";
import { buildZip, normalEntries } from "../../../packages/content/test/fixtures";
import { grantOperator, login, resetRateLimits, signUpVerified, totp } from "./helpers";

test.describe.configure({ mode: "serial" });

/** 처음 들어가면 2단계 인증 켜기 화면으로 간다 ➔ 켜고 원래 화면으로 */
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

/** 메일 대기열에 들어간 작업 (개발 PC 에 다른 코드의 worker 가 떠 있을 수 있어 보낸 메일 대신 대기열을 본다) */
async function queuedMail(template: string, to: string) {
  const { db, close } = createDb(process.env.DATABASE_URL!, { max: 1, quiet: true });
  try {
    const rows = await db.execute<{ data: Record<string, unknown> }>(
      sql`select data from pgboss.job where name = 'mail.send' and data->>'template' = ${template}
          and data->>'to' = ${to} order by created_on desc limit 1`,
    );
    return rows[0]?.data ?? null;
  } finally {
    await close();
  }
}

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

/** E2E_SCREENSHOTS=폴더 를 주면 화면을 밝게 · 어둡게 찍어 둔다 (눈으로 확인할 때) */
async function shoot(page: Page, name: string) {
  const dir = process.env.E2E_SCREENSHOTS;
  if (!dir) return;
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.screenshot({ path: join(dir, `${name}-${scheme}.png`), fullPage: true });
  }
  await page.emulateMedia({ colorScheme: "light" });
}

test("강사가 교재를 올리고 검수를 요청하면, 반려 사유가 강사에게 가고 다시 요청해 공개된다", async ({
  browser,
}, info) => {
  test.skip(info.project.name !== "desktop", "관리 화면 흐름은 데스크톱에서 한 번만 (끝에서 375px 도 본다)");
  test.setTimeout(420_000);
  const stamp = Date.now().toString(36);
  const opEmail = `e2e-op-${stamp}@example.com`;
  const teacherEmail = `e2e-teacher-${stamp}@example.com`;
  const password = "Calm-Forest-Engine-31";
  const displayName = `홍길동${stamp}`.slice(0, 20);
  const slug = `e2e-inst-${stamp}`;
  const title = `제로 트러스트 입문 ${stamp}`;
  const reason = `ch02_lab01 영상 연결이 필요합니다 ${stamp}`;

  const entries = (await normalEntries()).map((e) =>
    e.name === "course.json"
      ? { ...e, data: (e.data as string).replace('"ai-agent-basics"', `"${slug}"`) }
      : e,
  );
  const dir = join(tmpdir(), "aionit-e2e");
  mkdirSync(dir, { recursive: true });
  const packagePath = join(dir, `${slug}.zip`);
  writeFileSync(packagePath, buildZip(entries));

  const op = await (await browser.newContext()).newPage();
  const teacher = await (await browser.newContext()).newPage();

  // 1. 가입: 운영자 · 강사가 될 회원
  await resetRateLimits();
  await signUpVerified(op, opEmail, password, `op${stamp}`.slice(0, 16));
  await signUpVerified(teacher, teacherEmail, password, `teach${stamp}`.slice(0, 16));
  await grantOperator(opEmail);
  await login(op, opEmail, password);
  await op.waitForURL((url) => url.pathname === "/");

  // 2. 운영자: 강사 등록(회원 잇기) ➔ 계약 만들기 (AD-15)
  await op.goto("/admin/instructors");
  await setupTwoFactor(op, password);
  await expect(op.getByRole("heading", { name: "강사", exact: true })).toBeVisible();
  await op.getByLabel("공개 이름").fill(displayName);
  await op.getByLabel("가입한 회원의 이메일 (선택)").fill(teacherEmail);
  await op.getByRole("button", { name: "강사 등록" }).click();
  await expect(op.getByRole("heading", { name: displayName })).toBeVisible();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
  await op.getByLabel("시작하는 날").fill(today);
  await op.getByRole("button", { name: "계약 만들기" }).click();
  await expect(op.getByText("강사 동의 대기")).toBeVisible();
  expect(await queuedMail("instructor-notice", teacherEmail)).toMatchObject({ kind: "contract" });

  // 3. 강사: 다시 로그인(역할이 바뀌면 세션을 끝낸다) ➔ 2단계 인증 ➔ 대시보드 ➔ 계약 동의 ➔ 공개 프로필
  await login(teacher, teacherEmail, password);
  await teacher.waitForURL((url) => url.pathname === "/");
  await teacher.getByRole("link", { name: "강사 화면" }).first().click();
  await setupTwoFactor(teacher, password);
  await expect(teacher.getByRole("heading", { name: `${displayName} 강사님` })).toBeVisible();
  await teacher.getByRole("link", { name: /계약 기간과 강사 이용약관을 확인하고 동의해 주세요/ }).click();
  await teacher.getByText("계약 기간과 강사 이용약관을 읽었고 동의합니다.").click();
  await teacher.getByRole("button", { name: "동의하기" }).click();
  await expect(teacher.getByText("계약 중")).toBeVisible();
  await teacher
    .getByLabel("소개 (강의 상세의 강사 소개에 나옵니다)")
    .fill("클라우드 보안 · 제로 트러스트 15년");
  await teacher.getByRole("button", { name: "저장", exact: true }).click();
  await expect(teacher.getByText("저장했습니다.")).toBeVisible();

  // 4. 강사: 과정 만들기 ➔ 교재 올리기 ➔ 검사 통과 ➔ 검수 요청 (I-02 · I-03 · I-05)
  await teacher.goto("/instructor/courses");
  await teacher.getByLabel("과정 ID").fill(slug);
  await teacher.getByLabel("과정 이름").fill(title);
  await teacher.getByLabel("수준").fill("입문");
  await teacher.getByLabel("한 줄 소개").fill("경계 없는 네트워크의 접근 통제");
  await teacher.getByRole("button", { name: "과정 만들기" }).click();
  await expect(teacher.getByText(`Course · ${slug}`)).toBeVisible();
  await expect(teacher.getByText("작성 중", { exact: true })).toBeVisible();
  await teacher.getByLabel(/zip 파일 \(course_id/).setInputFiles(packagePath);
  await teacher.getByRole("button", { name: "올리기", exact: true }).click();
  await expect(teacher.getByText("구조 · 허용 목록 · 그림 검사 통과")).toBeVisible({ timeout: 90_000 });
  await expect(teacher.getByText("검사 통과 · 검수 요청 전")).toBeVisible();
  const versionUrl = teacher.url();
  // 공개 전 미리보기: 수강생이 볼 본문 · 그림
  await teacher.getByRole("link", { name: /ch01/ }).first().click();
  // 공개 전 버전의 그림은 운영자 · 그 과정 강사만 받는다
  const src = await teacher.locator(".reader img").first().getAttribute("src");
  expect((await teacher.request.get(src!)).status()).toBe(200);
  expect((await op.request.get(src!)).status()).toBe(200);
  expect((await (await browser.newContext()).request.get(new URL(src!, teacher.url()).href)).status()).toBe(
    404,
  );
  await teacher.goBack();
  await teacher.getByLabel("변경 내용 메모 (운영자가 검수할 때 봅니다)").fill("첫 교재 올림");
  await teacher.getByRole("button", { name: "검수 요청" }).click();
  await expect(teacher.getByText("운영자가 검수하고 있습니다")).toBeVisible();

  // 5. 운영자: 검수 대기 목록 ➔ 반려 (사유)
  await op.goto("/admin/reviews");
  const row = op.getByRole("listitem").filter({ hasText: title });
  await expect(row).toContainText("메모: 첫 교재 올림");
  await row.getByRole("link").click();
  await expect(op.getByText("강사 검수 요청", { exact: false })).toBeVisible();
  await op.getByLabel("반려 사유 (필수)").fill(reason);
  op.once("dialog", (dialog) => void dialog.accept());
  await op.getByRole("button", { name: "반려", exact: true }).click();
  await op.waitForURL(/\/admin\/courses\/[0-9a-f-]+$/);

  // 6. 강사: 버전 화면 · 대시보드 · 사이트 알림에 사유, 메일 대기열에 사유
  await teacher.goto(versionUrl);
  await expect(teacher.getByText(`사유: ${reason}`)).toBeVisible();
  await shoot(teacher, "version-rejected");
  await teacher.goto("/instructor");
  await expect(teacher.getByText(`사유: ${reason}`)).toBeVisible();
  await shoot(teacher, "dashboard");
  await teacher.goto("/my/notifications");
  await expect(teacher.getByText(`반려: ${title} v0.2.0`)).toBeVisible();
  expect(await queuedMail("content-review", teacherEmail)).toMatchObject({ result: "rejected", reason });
  await teacher.goto(versionUrl);
  await expect(teacher.getByRole("heading", { name: "고친 뒤 다시 검수 요청" })).toBeVisible();
  await teacher.getByLabel("변경 내용 메모 (운영자가 검수할 때 봅니다)").fill("영상 자리 확인함");
  await teacher.getByRole("button", { name: "검수 요청" }).click();
  await expect(teacher.getByText("운영자가 검수하고 있습니다")).toBeVisible();

  // 7. 운영자: 승인하고 공개
  await op.goto("/admin/reviews");
  await op.getByRole("listitem").filter({ hasText: title }).getByRole("link").click();
  op.once("dialog", (dialog) => void dialog.accept());
  await op.getByRole("button", { name: "승인하고 공개" }).click();
  await op.waitForURL(/\/admin\/courses\/[0-9a-f-]+$/);
  expect(await queuedMail("content-review", teacherEmail)).toMatchObject({ result: "published" });

  // 8. 강의 상세의 강사 소개 ➔ 강사 소개 화면 (P-03 · P-06)
  await teacher.goto(`/courses/${slug}`);
  await expect(teacher.getByRole("heading", { name: "강사 소개" })).toBeVisible();
  await expect(teacher.getByText("클라우드 보안 · 제로 트러스트 15년")).toBeVisible();
  await teacher.getByRole("link", { name: "이 강사의 강의 보기 →" }).click();
  await expect(teacher.getByRole("heading", { name: displayName })).toBeVisible();
  await expect(teacher.getByRole("link", { name: title })).toBeVisible();

  // 9. 강사: 내 강의 공개 ➔ 판매 · 수강 현황 (숫자만) ➔ Q&A
  await teacher.goto("/instructor/courses");
  const courseRow = teacher.getByRole("row").filter({ hasText: title });
  await expect(courseRow.getByText("공개", { exact: true })).toBeVisible();
  await courseRow.getByRole("link", { name: "판매 · 수강 →" }).click();
  await expect(teacher.getByRole("heading", { name: `${title} 현황` })).toBeVisible();
  await expect(teacher.getByText("진도 분포")).toBeVisible();
  await shoot(teacher, "stats");
  const statsUrl = teacher.url();
  await teacher.goto("/instructor/qna");
  await expect(teacher.getByText("질문이 없습니다.")).toBeVisible();
  await teacher.goto("/instructor/profile");
  await shoot(teacher, "profile");
  await op.goto("/admin/instructors");
  await op.getByRole("link", { name: displayName }).click();
  await expect(op.getByRole("heading", { name: displayName })).toBeVisible();
  await expect(op.getByText("계약 중")).toBeVisible();
  await shoot(op, "admin-instructor");

  // 10. 막힘: 관리자 화면은 403, 없는 과정 · 남의 과정은 404
  await teacher.goto("/admin");
  await expect(teacher.getByRole("heading", { name: "이 화면을 볼 권한이 없습니다" })).toBeVisible();
  const missing = await teacher.goto("/instructor/courses/00000000-0000-7000-8000-000000000000");
  expect(missing?.status()).toBe(404);

  // 11. 375px: 강사 화면에 가로 스크롤이 없다
  await teacher.setViewportSize({ width: 375, height: 812 });
  for (const path of [
    "/instructor",
    "/instructor/courses",
    statsUrl,
    "/instructor/qna",
    "/instructor/profile",
    versionUrl,
  ]) {
    await teacher.goto(path);
    expect(await noHorizontalScroll(teacher), `${path} 가로 스크롤`).toBe(true);
    await shoot(teacher, `mobile-${path.split("/").filter(Boolean).slice(-1)[0]}`);
  }
  await teacher.goto("/instructor/courses");
  await teacher.getByRole("link", { name: title }).click();
  expect(await noHorizontalScroll(teacher), "과정 관리 가로 스크롤").toBe(true);
  await shoot(teacher, "mobile-course");
});
