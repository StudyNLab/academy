// 화면 흐름 (M9): 운영자 계산 ➔ 확정(명세 공개) ➔ 강사 명세(I-08) ➔ 이의 신청 ➔ 운영자 답변 · 조정 ➔ 지급 기록 ➔
// 강사 대시보드 예상 정산액 ➔ 375px 가로 스크롤 없음.
// 끝난 달이 있어야 계산할 수 있어 지난달(KST)에 판매 · 구독 · 학습 시간을 DB 로 넣고, 그 달에 시행 중인 개발용 기본 정책을 하나 둔다.
// 개발 DB 를 같이 쓰므로 끝나면 이 시험이 만든 정산 · 정책 · 주문을 보관 정리 모드로 지운다.
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { addMonths, kstMonth, splitVat } from "@aionit/core";
import { sealPii } from "@aionit/core/media";
import { createDb, eq, inArray, schema, sql } from "@aionit/db";
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

const month = addMonths(kstMonth(new Date()), -1);
const at = (day: string, time = "10:00:00") => new Date(`${month}-${day}T${time}+09:00`);
const created: {
  orders: string[];
  policy?: string;
  instructor?: string;
  course?: string;
  subscription?: string;
} = {
  orders: [],
};

/** 지난달 판매 2건(하나는 일부 환불) + 구독 1건 + 구독 학습 시간, 그 달에 시행 중인 개발용 기본 정책 */
async function seed(teacherEmail: string, buyerEmail: string, stamp: string) {
  const { db, close } = createDb(process.env.DATABASE_URL!, { max: 1, quiet: true });
  try {
    const one = async (email: string) =>
      (
        await db
          .select()
          .from(schema.users)
          .where(sql`lower(${schema.users.email}) = ${email}`)
      )[0]!;
    const teacher = await one(teacherEmail);
    const buyer = await one(buyerEmail);
    const [periods] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.settlementPeriods);
    test.skip(periods!.n > 0, "개발 DB 에 이미 정산한 달이 있어 이 시험의 지난달 계산 순서가 맞지 않습니다");
    const [policy] = await db
      .insert(schema.revenuePolicies)
      .values({
        scope: "default",
        singleRateBp: 6000,
        subscriptionPoolRateBp: 5000,
        pgFeeRateBp: 340,
        learningRules: {
          version: "2026-11-v1",
          dailyCapSec: 10800,
          bucketSec: 30,
          idleStopSec: 120,
          videoCompleteRatio: 0.9,
        },
        effectiveFrom: new Date(`${month}-01T00:00:00+09:00`),
        note: `화면 흐름 시험용 ${stamp}`,
      })
      .returning();
    created.policy = policy!.id;
    await db
      .insert(schema.userRoles)
      .values({ userId: teacher.id, role: "instructor", reason: "화면 흐름 시험" });
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, teacher.id));
    const [instructor] = await db
      .insert(schema.instructors)
      .values({ userId: teacher.id, displayName: `정산강사${stamp}`.slice(0, 20) })
      .returning();
    created.instructor = instructor!.id;
    const secret = process.env.BETTER_AUTH_SECRET!;
    await db.insert(schema.payoutProfiles).values({
      instructorId: instructor!.id,
      taxType: "individual",
      rrnSealed: sealPii(secret, "rrn", "9001011234567"),
      bankName: "국민은행",
      bankAccountSealed: sealPii(secret, "bank-account", "123456785678"),
      bankAccountLast4: "5678",
      accountHolder: "정산강사",
    });
    const [course] = await db
      .insert(schema.courses)
      .values({
        slug: `e2e-settle-${stamp}`,
        ownerInstructorId: instructor!.id,
        title: `정산 시험 과정 ${stamp}`,
        field: "security",
      })
      .returning();
    created.course = course!.id;
    const [product] = await db
      .insert(schema.products)
      .values({ type: "course", name: "정산 시험 강의" })
      .returning();
    const [subProduct] = await db
      .insert(schema.products)
      .values({ type: "subscription", name: "정산 시험 구독", billingInterval: "month", status: "stopped" })
      .returning();
    await db.update(schema.products).set({ status: "stopped" }).where(eq(schema.products.id, product!.id));

    const order = async (paid: number, when: Date, type: "course" | "subscription", fee: number) => {
      const { supply, vat } = splitVat(paid);
      const [o] = await db
        .insert(schema.orders)
        .values({
          userId: buyer.id,
          status: "paid",
          totalAmount: paid,
          orderName: "정산 시험",
          expiresAt: when,
          paidAt: when,
        })
        .returning();
      created.orders.push(o!.id);
      const [item] = await db
        .insert(schema.orderItems)
        .values({
          orderId: o!.id,
          productId: type === "course" ? product!.id : subProduct!.id,
          productType: type,
          courseId: type === "course" ? course!.id : null,
          productName: "정산 시험",
          listPrice: paid,
          paidAmount: paid,
          supplyAmount: supply,
          vatAmount: vat,
        })
        .returning();
      await db.insert(schema.payments).values({
        orderId: o!.id,
        providerPaymentKey: `e2e-settle-${o!.id}`,
        amount: paid,
        status: "done",
        feeAmount: fee,
        approvedAt: when,
      });
      return { order: o!, item: item! };
    };
    const first = await order(59_000, at("03"), "course", 1_180);
    await order(44_250, at("12"), "course", 805);
    await db.insert(schema.refunds).values({
      orderItemId: first.item.id,
      userId: buyer.id,
      status: "done",
      calculation: {},
      requestedAmount: 29_500,
      approvedAmount: 29_500,
      reason: "화면 흐름 시험",
      doneAt: at("20"),
    });
    const sub = await order(17_700, at("05"), "subscription", 0);
    const [s] = await db
      .insert(schema.subscriptions)
      .values({
        userId: buyer.id,
        productId: subProduct!.id,
        status: "ended",
        interval: "month",
        planName: "정산 시험 구독",
        amount: 17_700,
        customerKey: `e2e-${stamp}`,
        autoRenewAgreedAt: at("05"),
        termsAgreedAt: at("05"),
        endedAt: at("28"),
      })
      .returning();
    created.subscription = s!.id;
    const { supply, vat } = splitVat(17_700);
    await db.insert(schema.subscriptionCycles).values({
      subscriptionId: s!.id,
      cycleNo: 1,
      billingDate: `${month}-05`,
      periodStart: at("05"),
      periodEnd: at("28"),
      amount: 17_700,
      supplyAmount: supply,
      vatAmount: vat,
      status: "paid",
      orderId: sub.order.id,
    });
    await db.insert(schema.learningTimeDaily).values({
      userId: buyer.id,
      courseId: course!.id,
      date: `${month}-06`,
      videoSec: 5_400,
      textSec: 0,
      effectiveSec: 5_400,
      ruleVersion: "2026-11-v1",
      access: "subscription",
    });
  } finally {
    await close();
  }
}

async function cleanup() {
  const { db, close } = createDb(process.env.DATABASE_URL!, { max: 1, quiet: true });
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local aionit.retention_purge = 'on'`);
      const [period] = await tx
        .select()
        .from(schema.settlementPeriods)
        .where(eq(schema.settlementPeriods.month, month));
      if (period) {
        const ids = (
          await tx
            .select({ id: schema.settlements.id })
            .from(schema.settlements)
            .where(eq(schema.settlements.periodId, period.id))
        ).map((r) => r.id);
        if (ids.length) {
          await tx.delete(schema.settlementLines).where(inArray(schema.settlementLines.settlementId, ids));
          await tx.delete(schema.payouts).where(inArray(schema.payouts.settlementId, ids));
          const objections = tx
            .select({ id: schema.settlementObjections.id })
            .from(schema.settlementObjections)
            .where(inArray(schema.settlementObjections.settlementId, ids));
          await tx
            .delete(schema.settlementAdjustments)
            .where(inArray(schema.settlementAdjustments.objectionId, objections));
          await tx
            .delete(schema.settlementObjections)
            .where(inArray(schema.settlementObjections.settlementId, ids));
          await tx.delete(schema.settlements).where(inArray(schema.settlements.id, ids));
        }
        await tx.delete(schema.settlementPeriods).where(eq(schema.settlementPeriods.id, period.id));
      }
      if (created.instructor)
        await tx
          .delete(schema.settlementAdjustments)
          .where(eq(schema.settlementAdjustments.instructorId, created.instructor));
      if (created.policy)
        await tx.delete(schema.revenuePolicies).where(eq(schema.revenuePolicies.id, created.policy));
      if (created.orders.length) {
        const items = tx
          .select({ id: schema.orderItems.id })
          .from(schema.orderItems)
          .where(inArray(schema.orderItems.orderId, created.orders));
        await tx.delete(schema.refunds).where(inArray(schema.refunds.orderItemId, items));
        if (created.subscription) {
          await tx
            .delete(schema.subscriptionCycles)
            .where(eq(schema.subscriptionCycles.subscriptionId, created.subscription));
          await tx.delete(schema.subscriptions).where(eq(schema.subscriptions.id, created.subscription));
        }
        await tx.delete(schema.payments).where(inArray(schema.payments.orderId, created.orders));
        await tx.delete(schema.orderItems).where(inArray(schema.orderItems.orderId, created.orders));
        await tx.delete(schema.orders).where(inArray(schema.orders.id, created.orders));
      }
      if (created.course)
        await tx
          .delete(schema.learningTimeDaily)
          .where(eq(schema.learningTimeDaily.courseId, created.course));
    });
  } finally {
    await close();
  }
}

test.afterAll(async () => {
  await cleanup();
});

test("운영자가 계산 · 확정하면 강사가 명세를 보고 이의 신청하고, 운영자가 답변 · 지급 기록을 남긴다", async ({
  browser,
}, info) => {
  test.skip(info.project.name !== "desktop", "관리 화면 흐름은 데스크톱에서 한 번만 (끝에서 375px 도 본다)");
  test.setTimeout(300_000);
  const stamp = Date.now().toString(36);
  const opEmail = `e2e-op-${stamp}@example.com`;
  const teacherEmail = `e2e-settle-${stamp}@example.com`;
  const buyerEmail = `e2e-buyer-${stamp}@example.com`;
  const password = "Calm-Forest-Engine-31";
  const label = `${Number(month.slice(5))}월`;

  const op = await (await browser.newContext()).newPage();
  const teacher = await (await browser.newContext()).newPage();
  const buyer = await (await browser.newContext()).newPage();
  await resetRateLimits();
  await signUpVerified(op, opEmail, password, `op${stamp}`.slice(0, 16));
  await signUpVerified(teacher, teacherEmail, password, `st${stamp}`.slice(0, 16));
  await signUpVerified(buyer, buyerEmail, password, `by${stamp}`.slice(0, 16));
  await grantOperator(opEmail);
  await seed(teacherEmail, buyerEmail, stamp);

  // 1. 운영자: 정산 관리 ➔ 지난달 계산 (AD-16)
  await login(op, opEmail, password);
  await op.waitForURL((url) => url.pathname === "/");
  await op.goto("/admin/settlements");
  await setupTwoFactor(op, password);
  await expect(op.getByRole("heading", { name: "정산 관리" })).toBeVisible();
  await expect(op.getByLabel("정산 월")).toHaveValue(month);
  await op.getByRole("button", { name: "계산", exact: true }).click();
  await expect(op.getByText(`${month} 정산을 계산했습니다`)).toBeVisible();
  await op.getByRole("link", { name: new RegExp(`${month.slice(0, 4)}년 ${label}`) }).click();
  await expect(op.getByText("계산됨 · 확정 전").first()).toBeVisible();
  await shoot(op, "admin-month-calculated");

  // 2. 확정 ➔ 명세 공개
  op.once("dialog", (d) => void d.accept());
  await op.getByRole("button", { name: "확정 · 명세 공개" }).click();
  await expect(op.getByText("확정 · 명세 공개", { exact: true })).toBeVisible();
  await op.getByRole("link", { name: /정산강사/ }).click();
  await expect(op.getByText("확정 · 지급 대기")).toBeVisible();
  // 판매 2건 · 환불 1건 · 구독 1과정
  await expect(op.getByRole("heading", { name: "환불 차감" })).toBeVisible();
  const itemUrl = op.url();

  // 3. 강사: 정산 ➔ 명세 (I-08) ➔ 이의 신청
  await login(teacher, teacherEmail, password);
  await teacher.waitForURL((url) => url.pathname === "/");
  await teacher.goto("/instructor/settlements");
  await setupTwoFactor(teacher, password);
  await expect(teacher.getByRole("heading", { name: "정산", exact: true })).toBeVisible();
  await teacher
    .getByRole("link", { name: new RegExp(`${label}`) })
    .first()
    .click();
  await expect(teacher.getByRole("heading", { name: new RegExp(`정산 명세 · .*${label}`) })).toBeVisible();
  await expect(teacher.getByText("지급 예정액")).toBeVisible();
  await expect(teacher.getByText("국민은행 •••• 5678", { exact: false })).toBeVisible();
  await expect(teacher.getByText(/이번 달 강사 배분 풀/)).toBeVisible();
  // 구매자 정보가 보이지 않는다
  await expect(teacher.getByText(buyerEmail)).toHaveCount(0);
  await expect(teacher.getByText(`by${stamp}`.slice(0, 16))).toHaveCount(0);
  const csv = await teacher.request.get(`/api/v1/instructor/settlements/${month}/csv`);
  expect(csv.status()).toBe(200);
  const csvText = await csv.text();
  expect(csvText).toContain("지급 예정액");
  expect(csvText).not.toContain(buyerEmail);
  await shoot(teacher, "instructor-statement");
  await teacher.getByLabel(/무엇이 다른지 적어 주세요/).fill(`3일 판매의 환불 차감을 확인해 주세요 ${stamp}`);
  await teacher.getByRole("button", { name: "이의 신청" }).click();
  await expect(teacher.getByText("이의 신청을 보냈습니다")).toBeVisible();
  await expect(teacher.getByText("답변 기다리는 중")).toBeVisible();

  // 4. 운영자: 답변 + 조정 ➔ 지급 기록 (계좌번호는 누를 때만, 조회 기록)
  await op.goto(itemUrl);
  await expect(op.getByText(`3일 판매의 환불 차감을 확인해 주세요 ${stamp}`)).toBeVisible();
  await op
    .getByLabel("답변 (강사에게 보입니다)")
    .fill("확인했습니다. 다음 달에 1,000원을 조정으로 넣습니다.");
  await op.getByLabel(/다음 달 정산에 넣을 조정 금액/).fill("1000");
  await op.getByRole("button", { name: "답변", exact: true }).click();
  await expect(op.getByText("답변했습니다")).toBeVisible();
  await expect(op.getByText("다음 달 조정 1,000원")).toBeVisible();
  await op.getByRole("button", { name: "계좌번호 보기 (조회 기록)" }).click();
  await expect(op.getByText("123456785678")).toBeVisible();
  op.once("dialog", (d) => void d.accept());
  await op.getByRole("button", { name: "지급 기록" }).click();
  await expect(op.getByText("지급을 기록했습니다")).toBeVisible();
  await expect(op.getByText("지급함")).toBeVisible();
  await shoot(op, "admin-settlement-paid");

  // 5. 강사: 답변 · 지급 확인, 대시보드 예상 정산액
  await teacher.reload();
  await expect(teacher.getByText("확인했습니다. 다음 달에 1,000원을 조정으로 넣습니다.")).toBeVisible();
  await expect(teacher.getByText(/보냈습니다/)).toBeVisible();
  await teacher.goto("/instructor");
  await expect(teacher.getByText(/월 예상 정산액 \(세전\)/)).toBeVisible();

  // 6. 배분 정책 화면: 시험용 정책 · 기본 정책 v1
  await op.goto("/admin/settlements/policies");
  await expect(op.getByText("기본 정책 v1")).toBeVisible();
  await shoot(op, "admin-policies");

  // 7. 375px: 정산 화면들 가로 스크롤 없음 (표는 표 안에서만 움직인다)
  for (const page of [op, teacher]) await page.setViewportSize({ width: 375, height: 812 });
  for (const path of [
    "/admin/settlements",
    `/admin/settlements/${month}`,
    itemUrl,
    "/admin/settlements/policies",
  ]) {
    await op.goto(path);
    expect(await noHorizontalScroll(op), path).toBe(true);
  }
  for (const path of ["/instructor", "/instructor/settlements", `/instructor/settlements/${month}`]) {
    await teacher.goto(path);
    expect(await noHorizontalScroll(teacher), path).toBe(true);
  }
  await shoot(teacher, "instructor-statement-375");
  await shoot(op, "admin-policies-375");
});
