import { describe, expect, it } from "vitest";
import { createMemoryMailer, renderMail } from "./index";

describe("renderMail", () => {
  it("인증 메일에 링크가 글 · HTML 모두 들어간다", () => {
    const url = "https://aionit.test/api/v1/auth/verify-email?token=abc&callbackURL=%2Flogin";
    const mail = renderMail({ template: "verify-email", to: "a@example.com", userId: null, url });
    expect(mail.subject).toBe("[AIONIT] 이메일 주소를 확인해 주세요");
    expect(mail.text).toContain(url);
    expect(mail.html).toContain(url.replaceAll("&", "&amp;"));
  });

  it("HTML 에 넣는 값은 이스케이프한다", () => {
    const mail = renderMail({
      template: "reset-password",
      to: "a@example.com",
      userId: null,
      url: 'https://x.test/"><script>alert(1)</script>',
    });
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
  });

  it("모든 문안에 발신 전용 안내가 있다", () => {
    const jobs = [
      { template: "password-changed", to: "a@example.com", userId: null },
      {
        template: "signup-existing",
        to: "a@example.com",
        userId: null,
        loginUrl: "https://x.test/login",
        resetUrl: "https://x.test/forgot-password",
      },
    ] as const;
    for (const job of jobs) expect(renderMail(job).html).toContain("발신 전용");
  });
});

describe("결제 · 환불 · 만료 알림 메일 (M5)", () => {
  it("영수증: 금액 · 공급가액 · 부가세 · 수강 기간 · 토스 영수증", () => {
    const mail = renderMail({
      template: "payment-receipt",
      to: "a@example.com",
      userId: null,
      productName: "AI Agent 개발 · 초급",
      listPrice: 59_000,
      discountAmount: 14_750,
      paidAmount: 44_250,
      supplyAmount: 40_227,
      vatAmount: 4_023,
      paidAt: "2026-11-03T05:00:00.000Z",
      accessUntil: "2027-11-03T15:00:00.000Z",
      receiptUrl: "https://dashboard.tosspayments.com/receipt/x",
      historyUrl: "https://x.test/my/payments",
    });
    expect(mail.subject).toBe("[AIONIT] 결제가 끝났습니다");
    expect(mail.text).toContain("44,250원");
    expect(mail.text).toContain("부가세 4,023원");
    expect(mail.text).toContain("2027년 11월 3일 까지");
    expect(mail.text).toContain("https://dashboard.tosspayments.com/receipt/x");
  });

  it("만료 알림: 남은 날과 마지막 이용일", () => {
    const mail = renderMail({
      template: "expiry-reminder",
      to: "a@example.com",
      userId: null,
      courseTitle: "AI Agent 개발 · 초급",
      daysLeft: 7,
      endsAt: "2026-11-11T15:00:00.000Z",
      courseUrl: "https://x.test/courses/ai",
    });
    expect(mail.subject).toBe("[AIONIT] 수강 기간이 7일 남았습니다");
    expect(mail.text).toContain("2026년 11월 11일 에 끝납니다");
  });

  it("환불 완료 · 거절", () => {
    const done = renderMail({
      template: "refund-done",
      to: "a@example.com",
      userId: null,
      productName: "강의",
      amount: 22_125,
      historyUrl: "https://x.test/my/payments",
    });
    expect(done.text).toContain("22,125원");
    const rejected = renderMail({
      template: "refund-rejected",
      to: "a@example.com",
      userId: null,
      productName: "강의",
      note: "<b>규정</b>",
      historyUrl: "https://x.test/my/payments",
    });
    expect(rejected.html).toContain("&lt;b&gt;");
  });
});

describe("createMemoryMailer", () => {
  it("보낸 메일을 모아 둔다", async () => {
    const mailer = createMemoryMailer();
    await mailer.send({ to: "a@example.com", subject: "s", text: "t", html: "h" });
    expect(mailer.sent).toHaveLength(1);
  });
});
