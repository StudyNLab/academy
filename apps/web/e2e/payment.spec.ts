// 화면 흐름 (M5): 운영자 상품 · 가격(AD-07) ➔ 강의 상세 구매 카드(P-03) ➔ 주문서(C-01) ➔ 결제 ➔ 결제 완료(C-03)
// ➔ 학습 ➔ 결제 내역(M-04) ➔ 환불 요청 ➔ 운영자 환불 처리(AD-10) ➔ 수강권 끝 ➔ L-05 연장 · 구매 버튼, 모바일 폭.
// 토스 테스트 모드도 카드 결제는 카드사 본인 인증(실제 카드)을 거쳐 자동화할 수 없어서, 가짜 결제(TOSS_FAKE=1)로 돈다:
//   pnpm --filter @aionit/web test:e2e:build e2e/payment.spec.ts   (화면 흐름 시험용 실제 빌드, 가짜 결제가 켜짐)
//   또는 preview `web-3300` ➔ E2E_BASE_URL=http://localhost:3300 pnpm exec playwright test e2e/payment.spec.ts
// 실제 토스 테스트 결제는 테스트 서버에서 사람이 한 번 확인한다 (docs/개발기록/M5.md)
import { expect, test } from "@playwright/test";
import { createDb, eq, schema } from "@aionit/db";
import { createS3StoreFromEnv } from "@aionit/storage";
import { processCourseVersion } from "../../worker/src/content";
import { buildZip, normalEntries } from "../../../packages/content/test/fixtures";
import { createCourse, createInstructor, publishVersion, uploadPackage } from "../src/server/courses";
import { grantOperator, login, resetRateLimits, signUpVerified, totp } from "./helpers";

test.describe.configure({ mode: "serial" });

async function publishPremiumCourse(slug: string, title: string, operatorEmail: string) {
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
      inSubscription: false,
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
  } finally {
    await close();
  }
}

test("운영자가 상품을 만들고, 수강생이 테스트 결제로 사서 학습하고, 환불을 요청하면 운영자가 처리한다", async ({
  page,
  browser,
}, info) => {
  test.skip(info.project.name !== "desktop", "결제 흐름은 데스크톱에서 한 번 (모바일 폭은 아래에서)");
  test.setTimeout(420_000);
  const stamp = Date.now().toString(36);
  const slug = `e2e-pay-${stamp}`;
  const title = `결제 시험 ${stamp}`;
  const password = "Calm-Forest-Engine-31";
  const opEmail = `e2e-payop-${stamp}@example.com`;
  const buyerEmail = `e2e-buyer-${stamp}@example.com`;
  await resetRateLimits();

  // 0. 운영자 ➔ 2단계 인증 ➔ 시험 과정 (프리미엄)
  await signUpVerified(page, opEmail, password, `po${stamp}`.slice(0, 16));
  await grantOperator(opEmail);
  await publishPremiumCourse(slug, title, opEmail);
  await login(page, opEmail, password);
  await page.waitForURL((url) => url.pathname === "/");
  await page.goto("/admin/products");
  await expect(page).toHaveURL(/\/my\/security\?required=1/);
  await page.getByLabel("비밀번호 확인").fill(password);
  await page.getByRole("button", { name: "2단계 인증 켜기" }).click();
  const secret = (await page.locator("code").first().textContent())!.trim();
  await page.getByLabel("인증 코드 (6자리)").fill(totp(secret));
  await page.getByRole("button", { name: "확인하고 켜기" }).click();
  await page.getByRole("button", { name: "하던 일로 돌아가기" }).click();
  await expect(page.getByRole("heading", { name: "상품 · 가격" })).toBeVisible();

  // 1. AD-07 상품 만들기: 1년 59,000원 + 연장권 90일 17,700원
  const form = page.locator("form", { has: page.getByRole("heading", { name: "상품 만들기" }) });
  await form.getByLabel("과정").selectOption({ label: title });
  await form.getByLabel("상품 이름").fill(`${title} (1년)`);
  await form.getByLabel("가격 (원, 부가세 포함)").fill("59000");
  await form.getByRole("button", { name: "상품 만들기" }).click();
  await expect(page.getByText(`${title} (1년)`)).toBeVisible();
  await form.getByLabel("종류").selectOption({ label: "연장권" });
  await form.getByLabel("과정").selectOption({ label: title });
  await form.getByLabel("상품 이름").fill(`${title} 연장 90일`);
  await form.getByLabel("가격 (원, 부가세 포함)").fill("17700");
  await form.getByRole("button", { name: "상품 만들기" }).click();
  await expect(page.getByText(`${title} 연장 90일`)).toBeVisible();

  // 2. 수강생: 강의 상세 구매 카드 ➔ 구매하기 ➔ (로그인) ➔ 주문서
  const buyerContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const buyer = await buyerContext.newPage();
  await signUpVerified(buyer, buyerEmail, password, `by${stamp}`.slice(0, 16));
  await buyer.goto(`/courses/${slug}`);
  const card = buyer.locator("aside");
  await expect(card.getByText("59,000원").first()).toBeVisible();
  await expect(card.getByText("수강 기간 결제일부터 1년")).toBeVisible();
  await card.getByRole("button", { name: "구매하기" }).first().click();
  await expect(buyer).toHaveURL(/\/login\?next=/);
  await buyer.getByLabel("이메일").fill(buyerEmail);
  await buyer.getByLabel("비밀번호", { exact: true }).fill(password);
  await buyer.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(buyer).toHaveURL(new RegExp(`/courses/${slug}$`));
  await buyer.locator("aside").getByRole("button", { name: "구매하기" }).first().click();
  await expect(buyer).toHaveURL(/\/checkout\/[0-9a-f-]{36}$/);
  await expect(buyer.getByRole("heading", { name: "주문서" })).toBeVisible();
  await expect(buyer.getByText("(공급가액 53,636원 · 부가세 5,364원)")).toBeVisible();
  const pay = buyer.getByRole("button", { name: "59,000원 결제하기" });
  await expect(buyer.getByText("개발용 가짜 결제")).toBeVisible();
  await expect(pay).toBeDisabled(); // 동의해야 켜진다
  await buyer.getByText("(필수) 주문 내용과 환불 규정을 확인했으며 결제에 동의합니다").click();
  await pay.click();

  // 3. 결제 완료 (C-03) ➔ 바로 학습하기
  await expect(buyer.getByRole("heading", { name: "결제가 끝났습니다" })).toBeVisible();
  await expect(buyer.getByText("59,000원")).toBeVisible();
  await buyer.getByRole("link", { name: "바로 학습하기" }).click();
  await expect(buyer).toHaveURL(new RegExp(`/learn/${slug}/ch01$`));
  await expect(buyer.getByRole("navigation", { name: "목차" }).first()).toBeVisible();
  // 강의 상세 카드는 "수강 중" + 연장권
  await buyer.goto(`/courses/${slug}`);
  await expect(buyer.locator("aside").getByText("이 강의를 수강하고 있습니다")).toBeVisible();
  await expect(buyer.locator("aside").getByRole("button", { name: /연장권 90일 · 17,700원/ })).toBeVisible();

  // 4. 결제 내역 (M-04) ➔ 환불 요청 (7일 이내 · 이용 전 ➔ 전액)
  await buyer.goto("/my/payments");
  await expect(buyer.getByText("결제 완료")).toBeVisible();
  await buyer.getByRole("link", { name: "환불 요청" }).click();
  await expect(buyer.getByText("결제일부터 7일 이내 · 이용 전")).toBeVisible();
  await expect(buyer.getByText("(전액)")).toBeVisible();
  await buyer.getByLabel("사유").selectOption({ label: "실수로 결제했어요" });
  await buyer.getByRole("button", { name: "환불 요청" }).click();
  await expect(buyer.getByText(/환불을 요청했습니다/)).toBeVisible();
  await buyer.goto("/my/payments");
  await expect(buyer.getByText("환불 요청됨")).toBeVisible();

  // 5. 운영자: 대시보드 ➔ 환불 (AD-10) ➔ 승인
  await page.goto("/admin");
  await expect(page.getByText("환불 요청 대기")).toBeVisible();
  await page.goto("/admin/refunds");
  await page.getByRole("link", { name: `${title} (1년)` }).click();
  await expect(page.getByText("요청한 날 계산 (환불 금액 기준)")).toBeVisible();
  await expect(
    page.getByText(/결제일부터 0일 \(7일 이내\) · 이용 전 ➔ 전액 = 59,000원/).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "59,000원 환불 승인" }).click();
  await expect(page.getByText("환불 완료")).toBeVisible();

  // 6. 수강생: 환불 완료, 수강권 끝 ➔ L-05 에 구매 버튼
  await buyer.goto("/my/payments");
  await expect(buyer.getByText("환불 완료")).toBeVisible();
  await expect(buyer.getByText("환불 59,000원")).toBeVisible();
  await buyer.goto(`/learn/${slug}/ch02`);
  await expect(buyer.getByRole("heading", { name: "이 강의의 수강권이 없습니다" })).toBeVisible();
  await expect(buyer.getByRole("button", { name: "구매하기 59,000원" })).toBeVisible();

  // 7. 모바일 폭: 강의 상세 아래 고정 구매 막대, 가로로 넘치지 않는다
  await buyer.setViewportSize({ width: 375, height: 812 });
  await buyer.goto(`/courses/${slug}`);
  await expect(buyer.getByText("59,000원").last()).toBeVisible();
  const overflow = await buyer.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  await buyer.screenshot({ path: info.outputPath("course-mobile.png") });
  await buyerContext.close();
});
