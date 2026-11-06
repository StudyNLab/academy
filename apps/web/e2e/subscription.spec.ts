// 화면 흐름 (M6): 운영자 구독 요금제(AD-07) ➔ 구독 안내 · 신청(P-05 · C-04, 자동결제 동의 따로) ➔ 카드 등록 ➔ 첫 결제
// ➔ 구독 포함 강의 학습 ➔ 구독 관리(M-03): 해지 예약(클릭 2번) · 해지 취소 ➔ 즉시 해지 · 환불 요청 ➔ 운영자 승인 ➔ 구독 끝.
// 카드 등록은 가짜 결제(TOSS_FAKE=1: `test:e2e:build` 또는 preview `web-3300`). 매일 자동결제 · 재시도는 통합 테스트(subscription-flow)
import { expect, test } from "@playwright/test";
import { and, createDb, eq, schema } from "@aionit/db";
import { createS3StoreFromEnv } from "@aionit/storage";
import { processCourseVersion } from "../../worker/src/content";
import { buildZip, normalEntries } from "../../../packages/content/test/fixtures";
import { createCourse, createInstructor, publishVersion, uploadPackage } from "../src/server/courses";
import { grantOperator, login, resetRateLimits, signUpVerified, totp } from "./helpers";

test.describe.configure({ mode: "serial" });

async function setup(slug: string, title: string, operatorEmail: string) {
  const { db, close } = createDb(process.env.DATABASE_URL!, { max: 2, quiet: true });
  const store = createS3StoreFromEnv();
  try {
    const [operator] = await db.select().from(schema.users).where(eq(schema.users.email, operatorEmail));
    const actorId = operator!.id;
    const instructor = await createInstructor(db, { displayName: "홍길동", actorId });
    const course = await createCourse(db, {
      slug,
      title,
      field: "ai",
      level: "초급",
      ownerInstructorId: instructor.id,
      summary: "",
      descriptionMd: "",
      audienceMd: "",
      requirementsMd: "",
      inSubscription: true,
      actorId,
    });
    const entries = (await normalEntries()).map((e) =>
      e.name === "course.json"
        ? { ...e, data: (e.data as string).replace('"ai-agent-basics"', `"${slug}"`) }
        : e,
    );
    const version = await uploadPackage(
      { db, store, enqueueContent: async () => undefined },
      { courseId: course.id, zip: buildZip(entries), fileName: `${slug}.zip`, actorId },
    );
    await processCourseVersion({ db, store }, version.id);
    await publishVersion(db, version.id, { actorId });
    // 개발 DB 에 이전 시험의 월간 요금제가 판매 중이면 멈춘다 (월간은 하나만 판다)
    await db
      .update(schema.products)
      .set({ status: "stopped" })
      .where(and(eq(schema.products.type, "subscription"), eq(schema.products.billingInterval, "month")));
  } finally {
    await close();
  }
}

test("구독 신청 ➔ 카드 등록 ➔ 첫 결제 ➔ 학습 ➔ 해지 예약 · 취소 ➔ 즉시 해지 · 환불 ➔ 끝", async ({
  page,
  browser,
}, info) => {
  test.skip(info.project.name !== "desktop", "구독 흐름은 데스크톱에서 한 번 (모바일 폭은 끝에서)");
  test.setTimeout(420_000);
  const stamp = Date.now().toString(36);
  const slug = `e2e-sub-${stamp}`;
  const title = `구독 시험 ${stamp}`;
  const password = "Calm-Forest-Engine-31";
  const opEmail = `e2e-subop-${stamp}@example.com`;
  const userEmail = `e2e-subuser-${stamp}@example.com`;
  await resetRateLimits();

  // 0. 운영자 ➔ 2단계 인증 ➔ 구독 요금제 만들기 (월간 19,900원)
  await signUpVerified(page, opEmail, password, `so${stamp}`.slice(0, 16));
  await grantOperator(opEmail);
  await setup(slug, title, opEmail);
  await login(page, opEmail, password);
  await page.waitForURL((url) => url.pathname === "/");
  await page.goto("/admin/products");
  await page.getByLabel("비밀번호 확인").fill(password);
  await page.getByRole("button", { name: "2단계 인증 켜기" }).click();
  const secret = (await page.locator("code").first().textContent())!.trim();
  await page.getByLabel("인증 코드 (6자리)").fill(totp(secret));
  await page.getByRole("button", { name: "확인하고 켜기" }).click();
  await page.getByRole("button", { name: "하던 일로 돌아가기" }).click();
  const form = page.locator("form", { has: page.getByRole("heading", { name: "상품 만들기" }) });
  await form.getByLabel("종류").selectOption({ label: "구독 요금제" });
  await form.getByLabel("결제 주기").selectOption({ label: "월간" });
  await form.getByLabel("상품 이름").fill(`월간 구독 ${stamp}`);
  await form.getByLabel("가격 (원, 부가세 포함)").fill("19900");
  await form.getByRole("button", { name: "상품 만들기" }).click();
  await expect(page.getByText(`월간 구독 ${stamp}`)).toBeVisible();

  // 1. 수강생: 강의 상세 ➔ 구독 알아보기 ➔ 구독 안내 · 신청
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const me = await ctx.newPage();
  await signUpVerified(me, userEmail, password, `su${stamp}`.slice(0, 16));
  await login(me, userEmail, password);
  await me.waitForURL((url) => url.pathname === "/");
  await me.goto("/subscribe");
  await expect(me.getByRole("heading", { name: "배움을 멈추지 않는 방법." })).toBeVisible();
  await expect(me.getByRole("link", { name: title })).toBeVisible(); // 포함된 강의
  await me.getByRole("radio", { name: /월간 19,900원/ }).check();
  await expect(me.getByText(/오늘 19,900원이 결제되고, .* 에 같은 금액이 자동으로 결제됩니다/)).toBeVisible();
  const pay = me.getByRole("button", { name: "카드 등록하고 19,900원 결제" });
  await expect(pay).toBeDisabled();
  await me.getByText("(필수) 위 내용과 정기결제(자동결제)에 동의합니다").click();
  await expect(pay).toBeDisabled(); // 동의 둘 다 있어야
  await me.getByText("(필수) 구독 이용약관 · 환불 규정에 동의합니다").click();
  await pay.click();

  // 2. 카드 등록 ➔ 첫 결제 ➔ 구독 시작 ➔ 학습
  await expect(me.getByRole("heading", { name: "구독이 시작되었습니다" })).toBeVisible({ timeout: 60_000 });
  await me.goto(`/learn/${slug}/ch01`);
  await expect(me.getByRole("navigation", { name: "목차" }).first()).toBeVisible();
  await me.goto(`/courses/${slug}`);
  await expect(me.locator("aside").getByText("구독으로 수강 중")).toBeVisible();

  // 3. 구독 관리: 해지 (클릭 2번) ➔ 해지 취소
  await me.goto("/my/subscription");
  await expect(me.getByText("이용 중")).toBeVisible();
  await expect(me.getByText(/19,900원/).first()).toBeVisible();
  await expect(me.getByText("신한카드 •••• 123*")).toBeVisible();
  await me.getByRole("button", { name: "구독 해지" }).click();
  await me.getByRole("dialog", { name: "구독 해지" }).getByRole("button", { name: "해지 예약" }).click();
  await expect(me.getByText("해지 예약됨")).toBeVisible();
  await expect(me.getByText(/까지 이용 후 끝납니다/)).toBeVisible();
  await me.getByRole("button", { name: "해지 취소" }).click();
  await expect(me.getByText("이용 중")).toBeVisible();

  // 4. 결제 수단 변경 (카드 등록창 ➔ 돌아와서 바꿈)
  await me.getByRole("button", { name: "결제 수단 변경" }).click();
  await expect(me.getByText("결제 수단을 바꿨습니다")).toBeVisible();
  await me.getByRole("link", { name: "구독 관리로" }).click();

  // 5. 즉시 해지 · 환불 (7일 이내 + 학습 신호 없이 ➔ 전액). 학습 화면을 열었지만 학습 신호(30초)가 가기 전이라 전액
  await me.getByRole("link", { name: /결제가 이미 된 기간을 바로 끝내고 환불받으려면/ }).click();
  await expect(me.getByRole("heading", { name: /즉시 해지 · 환불/ })).toBeVisible();
  await me.getByLabel("사유").selectOption({ label: "시간이 없어 들을 수 없어요" });
  await me.getByRole("button", { name: "환불 요청" }).click();
  await expect(me.getByText(/환불을 요청했습니다/)).toBeVisible();

  // 6. 운영자 승인 ➔ 구독 끝
  await page.goto("/admin/subscriptions");
  await expect(page.getByText(`월간 구독 ${stamp}`).first()).toBeVisible();
  await page.goto("/admin/refunds");
  await page.getByRole("link", { name: new RegExp(`월간 구독 ${stamp} \\(1회차\\)`) }).click();
  await page.getByRole("button", { name: /환불 승인/ }).click();
  await expect(page.getByText("환불 완료")).toBeVisible();
  await me.goto("/my/subscription");
  await expect(me.getByText(/구독이 끝났습니다/)).toBeVisible();
  await me.goto(`/learn/${slug}/ch02`);
  await expect(me.getByRole("heading", { name: "수강 기간이 끝났습니다" })).toBeVisible();
  await expect(me.getByRole("link", { name: "구독 알아보기 →" })).toBeVisible();

  // 7. 모바일 폭: 구독 안내가 가로로 넘치지 않는다
  await me.setViewportSize({ width: 375, height: 812 });
  await me.goto("/subscribe");
  expect(await me.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await me.screenshot({ path: info.outputPath("subscribe-mobile.png"), fullPage: true });
  await ctx.close();
});
