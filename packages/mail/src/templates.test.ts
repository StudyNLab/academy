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

describe("구독 안내 메일 (M6)", () => {
  it.each(["renewal", "price_change", "payment_failed", "cancel_scheduled", "ended"] as const)(
    "%s",
    (kind) => {
      const mail = renderMail({
        template: "subscription-notice",
        to: "a@example.com",
        userId: null,
        kind,
        planName: "연간 구독",
        amount: 199_000,
        date: "2027-11-03T15:00:00.000Z",
        reason: "카드 한도 초과",
        url: "https://x.test/my/subscription",
      });
      expect(mail.subject).toMatch(/^\[AIONIT\] /);
      expect(mail.text).toContain("https://x.test/my/subscription");
      expect(mail.html).toContain("발신 전용");
    },
  );

  it("갱신 안내에 결제일 · 금액 · 해지 방법", () => {
    const mail = renderMail({
      template: "subscription-notice",
      to: "a@example.com",
      userId: null,
      kind: "renewal",
      planName: "연간 구독",
      amount: 199_000,
      date: "2027-11-03T00:00:00+09:00",
      reason: null,
      url: "https://x.test/my/subscription",
    });
    expect(mail.text).toContain("2027년 11월 3일 에 199,000원 자동으로 결제됩니다");
    expect(mail.text).toContain("해지를 예약");
  });
});

describe("createMemoryMailer", () => {
  it("보낸 메일을 모아 둔다", async () => {
    const mailer = createMemoryMailer();
    await mailer.send({ to: "a@example.com", subject: "s", text: "t", html: "h" });
    expect(mailer.sent).toHaveLength(1);
  });
});

describe("Q&A · 1:1 문의 메일 (M7)", () => {
  it("답변 알림: 강의 · 질문 제목, 링크 하나, 끄는 곳 안내", () => {
    const mail = renderMail({
      template: "qna-answer",
      to: "a@example.com",
      userId: null,
      courseTitle: "AI Agent 개발 · 초급",
      questionTitle: "401 오류가 나요",
      fromStaff: true,
      url: "https://x.test/learn/ai/ch02?qna=q1",
    });
    expect(mail.subject).toBe("[AIONIT] 질문에 강사 답변이 달렸습니다");
    expect(mail.text).toContain('"401 오류가 나요"');
    expect(mail.text).toContain("알림 설정에서 끌 수 있습니다");
    expect(mail.text.match(/https?:\/\//g)).toHaveLength(1);
  });

  it("문의 답변 알림: 답변 내용은 메일에 넣지 않는다 (사이트에서 확인)", () => {
    const mail = renderMail({
      template: "inquiry-answer",
      to: "a@example.com",
      userId: null,
      title: "환불 문의",
      url: "https://x.test/my/inquiries/i1",
    });
    expect(mail.subject).toBe("[AIONIT] 1:1 문의에 답변이 왔습니다");
    expect(mail.text).toContain("https://x.test/my/inquiries/i1");
  });
});

describe("강사 메일 (M8)", () => {
  it("검수 반려: 사유가 글 · HTML 모두 들어가고, HTML 에서는 이스케이프된다", () => {
    const mail = renderMail({
      template: "content-review",
      to: "t@example.com",
      userId: null,
      courseTitle: "AI Agent 개발 · 초급",
      version: "0.3.0",
      result: "rejected",
      reason: "ch04_lab02 영상 연결이 필요합니다 <b>",
      url: "https://aionit.test/instructor/courses/1",
    });
    expect(mail.subject).toBe("[AIONIT] 교재 검수가 반려되었습니다");
    expect(mail.text).toContain("반려 사유: ch04_lab02 영상 연결이 필요합니다 <b>");
    expect(mail.html).toContain("ch04_lab02 영상 연결이 필요합니다 &lt;b&gt;");
    expect(mail.text).toContain("https://aionit.test/instructor/courses/1");
  });

  it("검수 통과 · 강사 등록 · 계약 동의 요청", () => {
    const published = renderMail({
      template: "content-review",
      to: "t@example.com",
      userId: null,
      courseTitle: "AI Agent 개발 · 초급",
      version: "0.3.0",
      result: "published",
      reason: null,
      url: "https://aionit.test/instructor",
    });
    expect(published.subject).toBe("[AIONIT] 교재가 검수를 통과해 공개되었습니다");
    const registered = renderMail({
      template: "instructor-notice",
      to: "t@example.com",
      userId: null,
      kind: "registered",
      displayName: "홍길동",
      url: "https://aionit.test/instructor",
    });
    expect(registered.text).toContain("2단계 인증");
    const contract = renderMail({
      template: "instructor-notice",
      to: "t@example.com",
      userId: null,
      kind: "contract",
      displayName: "홍길동",
      url: "https://aionit.test/instructor/profile",
    });
    expect(contract.subject).toBe("[AIONIT] 강사 계약 내용을 확인해 주세요");
  });
});
