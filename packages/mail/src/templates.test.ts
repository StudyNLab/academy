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

describe("createMemoryMailer", () => {
  it("보낸 메일을 모아 둔다", async () => {
    const mailer = createMemoryMailer();
    await mailer.send({ to: "a@example.com", subject: "s", text: "t", html: "h" });
    expect(mailer.sent).toHaveLength(1);
  });
});
