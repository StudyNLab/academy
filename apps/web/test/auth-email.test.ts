// 이메일 가입 ➔ 인증 메일 ➔ 로그인 ➔ 로그아웃 ➔ 비밀번호 재설정, 가입 동의 기록 (개발계획 M1)
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, schema, sql } from "@aionit/db";
import { currentPolicies } from "@/server/consents";
import {
  Browser,
  createVerifiedUser,
  resetDb,
  setupTestAuth,
  signupBody,
  STRONG_PASSWORD,
  tokenFromMail,
} from "./helpers";

const t = setupTestAuth();
afterAll(() => t.close());
beforeEach(async () => {
  await resetDb(t.db);
  t.mails.length = 0;
});

describe("이메일 가입 · 인증 · 로그인 · 로그아웃", () => {
  it("가입하면 인증 메일이 가고, 인증 전에는 로그인할 수 없다", async () => {
    const browser = new Browser(t.auth);
    const signup = await browser.call("POST", "/sign-up/email", signupBody());
    expect(signup.status).toBe(200);
    expect(browser.cookies.size).toBe(0); // 가입만으로는 로그인되지 않는다

    expect(t.mails.map((m) => m.template)).toEqual(["verify-email"]);

    const early = await browser.call("POST", "/sign-in/email", {
      email: "learner@example.com",
      password: STRONG_PASSWORD,
    });
    expect(early.status).toBe(403);
    expect(early.body.code).toBe("EMAIL_NOT_VERIFIED");
    expect(t.mails.filter((m) => m.template === "verify-email")).toHaveLength(2); // 로그인 시도 때 다시 보낸다

    const token = tokenFromMail(t.mails, "verify-email", "learner@example.com");
    const verify = await browser.call("GET", `/verify-email?token=${token}&callbackURL=/login?verified=1`);
    expect(verify.status).toBe(302);
    expect(verify.headers.get("location")).toBe("/login?verified=1");

    const login = await browser.call("POST", "/sign-in/email", {
      email: "learner@example.com",
      password: STRONG_PASSWORD,
    });
    expect(login.status).toBe(200);
    const session = await browser.call("GET", "/get-session");
    expect((session.body.user as { name: string }).name).toBe("클라우드고양이");

    const logout = await browser.call("POST", "/sign-out");
    expect(logout.status).toBe(200);
    const after = await browser.call("GET", "/get-session");
    expect((after.body as { user?: unknown }).user).toBeUndefined();
    const sessions = await t.db.select().from(schema.sessions);
    expect(sessions).toHaveLength(0);
  });

  it("비밀번호는 argon2id 로 저장하고, 토큰은 해시로만 남긴다", async () => {
    const browser = new Browser(t.auth);
    await browser.call("POST", "/sign-up/email", signupBody());
    const [account] = await t.db.select().from(schema.authAccounts);
    expect(account!.providerId).toBe("credential");
    expect(account!.password).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);

    await browser.call("POST", "/request-password-reset", {
      email: "learner@example.com",
      redirectTo: "/reset-password",
    });
    const token = tokenFromMail(t.mails, "reset-password", "learner@example.com");
    const rows = await t.db.select().from(schema.verifications);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.identifier).not.toContain(token);
  });

  it("틀린 비밀번호 · 없는 이메일은 같은 오류를 준다 (가입 여부를 알려 주지 않는다)", async () => {
    await createVerifiedUser(t);
    const browser = new Browser(t.auth);
    const wrong = await browser.call("POST", "/sign-in/email", {
      email: "learner@example.com",
      password: "Wrong-Pass-123",
    });
    const missing = await browser.call("POST", "/sign-in/email", {
      email: "nobody@example.com",
      password: "Wrong-Pass-123",
    });
    expect(wrong.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(wrong.body.code).toBe(missing.body.code);
  });
});

describe("가입 입력 검사", () => {
  it.each([
    [
      "이용약관 동의 없음",
      { consents: { terms: false, privacy: true, marketing: false } },
      "INVALID_SIGNUP_INPUT",
    ],
    [
      "개인정보 동의 없음",
      { consents: { terms: true, privacy: false, marketing: false } },
      "INVALID_SIGNUP_INPUT",
    ],
    ["동의 항목 자체가 없음", { consents: undefined }, "INVALID_SIGNUP_INPUT"],
    ["만 14세 확인 없음", { age14: false }, "INVALID_SIGNUP_INPUT"],
    ["닉네임 규칙 위반", { name: "운영자입니다" }, "INVALID_NICKNAME"],
    ["흔한 비밀번호", { password: "qwer1234!" }, "WEAK_PASSWORD"],
    ["이메일이 든 비밀번호", { password: "learner-2026-ok" }, "WEAK_PASSWORD"],
    ["짧은 비밀번호", { password: "Ab1!x" }, "WEAK_PASSWORD"],
  ])("%s ➔ 400 %s", async (_label, overrides, code) => {
    const browser = new Browser(t.auth);
    const result = await browser.call("POST", "/sign-up/email", signupBody(overrides));
    expect(result.status).toBe(400);
    expect(result.body.code).toBe(code);
    expect(await t.db.select().from(schema.users)).toHaveLength(0);
    expect(t.mails).toHaveLength(0);
  });

  it("닉네임은 대소문자 구분 없이 고유하다", async () => {
    await createVerifiedUser(t, { name: "CloudCat" });
    const result = await new Browser(t.auth).call(
      "POST",
      "/sign-up/email",
      signupBody({ email: "other@example.com", name: "cloudcat" }),
    );
    expect(result.status).toBe(400);
    expect(result.body.code).toBe("NICKNAME_TAKEN");
  });

  it("이미 가입한 이메일이면 화면은 같고, 주인에게 알림 메일이 간다", async () => {
    await createVerifiedUser(t);
    t.mails.length = 0;
    const result = await new Browser(t.auth).call(
      "POST",
      "/sign-up/email",
      signupBody({ name: "다른닉네임", password: "Another-Strong-Pass-9" }),
    );
    expect(result.status).toBe(200);
    expect(t.mails.map((m) => m.template)).toEqual(["signup-existing"]);
    expect(await t.db.select().from(schema.users)).toHaveLength(1);
  });

  it("동의는 문서 버전과 함께 user_consents 에 남는다 (선택 동의 거부도 남김)", async () => {
    const browser = new Browser(t.auth);
    await browser.call(
      "POST",
      "/sign-up/email",
      signupBody({ consents: { terms: true, privacy: true, marketing: true } }),
    );
    const rows = await t.db.execute<{
      kind: string;
      version: string;
      agreed: boolean;
      ip: string | null;
    }>(sql`
      select p.kind, p.version, c.agreed, c.ip from user_consents c join policy_documents p on p.id = c.policy_document_id
      order by p.kind`);
    // 그때 시행 중인 버전에 동의한다 (버전 이름은 정책 문서를 새로 올리면 바뀐다)
    const current = await currentPolicies(t.db, ["marketing", "privacy", "terms"]);
    expect(rows.map((r) => [r.kind, r.version, r.agreed])).toEqual([
      ["marketing", current.get("marketing")!.version, true],
      ["privacy", current.get("privacy")!.version, true],
      ["terms", current.get("terms")!.version, true],
    ]);
    expect(rows[0]!.ip).toBe(browser.ip);
    const [user] = await t.db.select().from(schema.users);
    expect(user!.age14ConfirmedAt).toBeInstanceOf(Date);
    expect(user!.nickname).toBe("클라우드고양이");
  });
});

describe("비밀번호 재설정", () => {
  it("메일 링크로 새 비밀번호를 정하면 다른 기기 로그인이 끝나고 알림 메일이 간다", async () => {
    const user = await createVerifiedUser(t);
    const other = new Browser(t.auth);
    expect(
      (await other.call("POST", "/sign-in/email", { email: user.email, password: user.password })).status,
    ).toBe(200);

    const browser = new Browser(t.auth);
    const request = await browser.call("POST", "/request-password-reset", {
      email: user.email,
      redirectTo: "/reset-password",
    });
    expect(request.status).toBe(200);
    const token = tokenFromMail(t.mails, "reset-password", user.email);

    const weak = await browser.call("POST", "/reset-password", { token, newPassword: "password1" });
    expect(weak.status).toBe(400);
    expect(weak.body.code).toBe("WEAK_PASSWORD");

    const reset = await browser.call("POST", "/reset-password", {
      token,
      newPassword: "New-Strong-Harbor-77",
    });
    expect(reset.status).toBe(200);
    expect(t.mails.at(-1)!.template).toBe("password-changed");

    // 같은 링크는 한 번만
    const again = await browser.call("POST", "/reset-password", {
      token,
      newPassword: "Other-Strong-Pass-55",
    });
    expect(again.status).toBe(400);

    expect((await other.call("GET", "/get-session")).body.user).toBeUndefined();
    expect(
      (await browser.call("POST", "/sign-in/email", { email: user.email, password: user.password })).status,
    ).toBe(401);
    const login = await browser.call("POST", "/sign-in/email", {
      email: user.email,
      password: "New-Strong-Harbor-77",
    });
    expect(login.status).toBe(200);
  });

  it("없는 이메일로 요청해도 같은 응답이고 메일은 가지 않는다", async () => {
    const result = await new Browser(t.auth).call("POST", "/request-password-reset", {
      email: "nobody@example.com",
      redirectTo: "/reset-password",
    });
    expect(result.status).toBe(200);
    expect(t.mails).toHaveLength(0);
  });
});

describe("Origin 확인 (CSRF)", () => {
  it("다른 사이트에서 온 로그인 요청은 막는다", async () => {
    const user = await createVerifiedUser(t);
    const response = await t.auth.handler(
      new Request("http://localhost:3000/api/v1/auth/sign-in/email", {
        method: "POST",
        headers: {
          origin: "https://evil.example",
          "content-type": "application/json",
          cookie: "aionit.session_token=x",
          "x-forwarded-for": "10.99.0.1",
        },
        body: JSON.stringify({ email: user.email, password: user.password }),
      }),
    );
    expect(response.status).toBe(403);
    const [row] = await t.db.select().from(schema.users).where(eq(schema.users.email, user.email));
    expect(row).toBeDefined();
  });
});
