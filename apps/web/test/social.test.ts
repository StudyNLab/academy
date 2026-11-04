// 소셜 로그인 (카카오 서버 응답을 흉내 낸다): 가입 화면에서만 가입, 같은 이메일 자동 연결 안 함(A-05),
// 로그인한 상태에서 직접 연결, 이메일 없는 카카오 회원, 소셜 세션의 관리자 화면 OTP 재확인
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, schema } from "@aionit/db";
import { setRole } from "@/server/members";
import { loadViewer, staffAccess } from "@/server/viewer";
import { Browser, createVerifiedUser, resetDb, setupTestAuth, totpFromUri } from "./helpers";

const t = setupTestAuth({ KAKAO_CLIENT_ID: "test-kakao-rest-key", KAKAO_CLIENT_SECRET: "test-kakao-secret" });
afterAll(() => t.close());
beforeEach(async () => {
  await resetDb(t.db);
  t.mails.length = 0;
});
afterEach(() => vi.unstubAllGlobals());

interface KakaoProfile {
  id: number;
  kakao_account: {
    email?: string;
    is_email_valid?: boolean;
    is_email_verified?: boolean;
    profile?: { nickname?: string };
  };
}

/** 카카오 토큰 · 사용자 정보 API 대신 답한다 */
function mockKakao(profile: KakaoProfile) {
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("https://kauth.kakao.com/oauth/token")) {
      return Response.json({ access_token: "kakao-access", token_type: "bearer", expires_in: 3600 });
    }
    if (url.startsWith("https://kapi.kakao.com/v2/user/me")) return Response.json(profile);
    return realFetch(input, init);
  });
}

/** 카카오 버튼 ➔ (카카오 화면) ➔ 돌아옴. 돌아온 뒤 이동할 주소를 준다 */
async function kakao(
  browser: Browser,
  profile: KakaoProfile,
  body: Record<string, unknown> = {},
  link = false,
) {
  const start = await browser.call("POST", link ? "/link-social" : "/sign-in/social", {
    provider: "kakao",
    callbackURL: "/",
    errorCallbackURL: "/login",
    ...body,
  });
  expect(start.status, JSON.stringify(start.body)).toBe(200);
  const authorize = new URL(start.body.url as string);
  expect(authorize.origin).toBe("https://kauth.kakao.com");
  expect(authorize.searchParams.get("scope")).toBe("profile_nickname");
  mockKakao(profile);
  const back = await browser.call(
    "GET",
    `/callback/kakao?code=test-code&state=${authorize.searchParams.get("state")}`,
  );
  vi.unstubAllGlobals();
  return back.headers.get("location") ?? "";
}

const signup = (nickname: string) => ({
  requestSignUp: true,
  additionalData: {
    signup: { nickname, age14: true, consents: { terms: true, privacy: true, marketing: false } },
  },
});

const noEmail: KakaoProfile = { id: 4242, kakao_account: { profile: { nickname: "카카오이름" } } };

describe("카카오 가입 · 로그인", () => {
  it("로그인 화면에서 처음 오면 가입되지 않고 가입 화면으로 안내한다", async () => {
    const location = await kakao(new Browser(t.auth), noEmail);
    expect(location).toContain("error=signup_disabled");
    expect(await t.db.select().from(schema.users)).toHaveLength(0);
  });

  it("동의 · 닉네임 없이 가입을 요청하면(API 직접 호출) 만들지 않는다", async () => {
    const location = await kakao(new Browser(t.auth), noEmail, { requestSignUp: true });
    expect(location).not.toBe("/");
    expect(await t.db.select().from(schema.users)).toHaveLength(0);
  });

  it("가입 화면에서 동의 · 닉네임과 함께 오면 가입되고, 다음부터는 로그인된다 (이메일 없는 카카오)", async () => {
    const browser = new Browser(t.auth);
    expect(await kakao(browser, noEmail, signup("카카오친구"))).toBe("/");
    const [user] = await t.db.select().from(schema.users);
    expect(user).toMatchObject({
      nickname: "카카오친구",
      email: "no-email-kakao-4242@no-email.invalid",
      image: null,
    });
    expect(user!.age14ConfirmedAt).toBeInstanceOf(Date);
    expect(await t.db.select().from(schema.userConsents)).toHaveLength(3);
    // 카카오가 준 이름("카카오이름")은 저장하지 않는다
    expect(JSON.stringify(user)).not.toContain("카카오이름");
    expect((await loadViewer(t.auth, t.db, browser.headers()))?.nickname).toBe("카카오친구");

    const again = new Browser(t.auth);
    expect(await kakao(again, noEmail)).toBe("/");
    expect((await loadViewer(t.auth, t.db, again.headers()))?.userId).toBe(user!.id);
    const logins = await t.db.select().from(schema.loginLogs);
    expect(logins.map((l) => [l.method, l.result])).toEqual([
      ["kakao", "success"],
      ["kakao", "success"],
    ]);
  });
});

describe("같은 이메일 계정 연결 (A-05)", () => {
  const sameEmail: KakaoProfile = {
    id: 777,
    kakao_account: { email: "learner@example.com", is_email_valid: true, is_email_verified: true },
  };

  it("자동으로 잇지 않고, 로그인한 뒤 직접 연결하면 그 다음부터 카카오로 들어온다", async () => {
    const user = await createVerifiedUser(t);
    const [row] = await t.db.select().from(schema.users).where(eq(schema.users.email, user.email));

    // 로그인 화면 · 가입 화면 모두 자동 연결하지 않는다
    expect(await kakao(new Browser(t.auth), sameEmail)).toContain("error=account_not_linked");
    expect(await kakao(new Browser(t.auth), sameEmail, signup("다른닉네임"))).toContain(
      "error=account_not_linked",
    );
    expect(
      await t.db.select().from(schema.authAccounts).where(eq(schema.authAccounts.providerId, "kakao")),
    ).toHaveLength(0);
    expect(await t.db.select().from(schema.users)).toHaveLength(1);

    // 이메일로 로그인한 상태에서 연결
    const browser = new Browser(t.auth);
    await browser.call("POST", "/sign-in/email", user);
    expect(await kakao(browser, sameEmail, { callbackURL: "/my" }, true)).toBe("/my");
    const linked = await t.db
      .select()
      .from(schema.authAccounts)
      .where(eq(schema.authAccounts.userId, row!.id));
    expect(linked.map((a) => a.providerId).sort()).toEqual(["credential", "kakao"]);
    // OAuth 토큰은 암호화해 저장한다
    expect(linked.find((a) => a.providerId === "kakao")!.accessToken).not.toBe("kakao-access");

    const viaKakao = new Browser(t.auth);
    expect(await kakao(viaKakao, sameEmail)).toBe("/");
    expect((await loadViewer(t.auth, t.db, viaKakao.headers()))?.userId).toBe(row!.id);
  });

  it("이메일이 없는 카카오도 로그인한 상태에서는 연결할 수 있다", async () => {
    const user = await createVerifiedUser(t);
    const browser = new Browser(t.auth);
    await browser.call("POST", "/sign-in/email", user);
    expect(await kakao(browser, noEmail, { callbackURL: "/my" }, true)).toBe("/my");
    const [row] = await t.db.select().from(schema.users);
    expect(row!.email).toBe(user.email); // 원래 이메일은 그대로
  });
});

describe("운영자가 소셜로 로그인하면", () => {
  it("관리자 화면 전에 OTP 를 다시 받는다", async () => {
    const user = await createVerifiedUser(t);
    const [row] = await t.db.select().from(schema.users).where(eq(schema.users.email, user.email));
    const browser = new Browser(t.auth);
    await browser.call("POST", "/sign-in/email", user);
    const uri = (await browser.call("POST", "/two-factor/enable", { password: user.password })).body
      .totpURI as string;
    await browser.call("POST", "/two-factor/verify-totp", { code: totpFromUri(uri) });
    await kakao(browser, noEmail, { callbackURL: "/my" }, true);
    await setRole(t.db, { actorId: null, userId: row!.id, role: "operator", grant: true, reason: "시험" });

    const social = new Browser(t.auth);
    expect(await kakao(social, noEmail)).toBe("/");
    const viewer = await loadViewer(t.auth, t.db, social.headers());
    expect(viewer?.twoFactorEnabled).toBe(true);
    expect(staffAccess(viewer, "operator")).toBe("verify_2fa");
    // 세션도 12시간짜리
    const [session] = await t.db.select().from(schema.sessions).where(eq(schema.sessions.userId, row!.id));
    expect(session!.expiresAt.getTime() - session!.createdAt.getTime()).toBeLessThanOrEqual(
      12 * 3600_000 + 5_000,
    );

    expect((await social.call("POST", "/two-factor/verify-totp", { code: totpFromUri(uri) })).status).toBe(
      200,
    );
    expect(staffAccess(await loadViewer(t.auth, t.db, social.headers()), "operator")).toBe("ok");
  });
});

describe("구글 · 카카오로만 가입한 운영자의 2단계 인증 (비밀번호 없음)", () => {
  it("방금 로그인했으면 비밀번호 없이 켜고, 로그인한 지 15분이 지나면 다시 로그인하게 한다", async () => {
    const browser = new Browser(t.auth);
    expect(await kakao(browser, noEmail, signup("카카오운영"))).toBe("/");
    const [row] = await t.db.select().from(schema.users);
    await setRole(t.db, { actorId: null, userId: row!.id, role: "operator", grant: true, reason: "시험" });
    // 역할이 바뀌면 다시 로그인해야 한다
    const op = new Browser(t.auth);
    expect(await kakao(op, noEmail)).toBe("/");
    expect(staffAccess(await loadViewer(t.auth, t.db, op.headers()), "operator")).toBe("setup_2fa");

    // 로그인한 지 오래된 세션: 거부
    const [session] = await t.db.select().from(schema.sessions).where(eq(schema.sessions.userId, row!.id));
    await t.db
      .update(schema.sessions)
      .set({ createdAt: new Date(Date.now() - 16 * 60_000) })
      .where(eq(schema.sessions.id, session!.id));
    const stale = await op.call("POST", "/two-factor/enable", { issuer: "AIONIT" });
    expect(stale.status).toBe(403);
    expect(stale.body.code).toBe("RELOGIN_REQUIRED");

    // 다시 로그인 ➔ 비밀번호 없이 켜기 ➔ 코드 확인 ➔ 관리 화면
    const fresh = new Browser(t.auth);
    expect(await kakao(fresh, noEmail)).toBe("/");
    const enabled = await fresh.call("POST", "/two-factor/enable", { issuer: "AIONIT" });
    expect(enabled.status, JSON.stringify(enabled.body)).toBe(200);
    const uri = enabled.body.totpURI as string;
    expect((await fresh.call("POST", "/two-factor/verify-totp", { code: totpFromUri(uri) })).status).toBe(
      200,
    );
    const viewer = await loadViewer(t.auth, t.db, fresh.headers());
    expect(viewer?.twoFactorEnabled).toBe(true);
    expect(staffAccess(viewer, "operator")).toBe("ok");

    // 다음 로그인부터는 구글 · 카카오로 들어와도 관리 화면 전에 OTP 를 다시 받는다
    const next = new Browser(t.auth);
    expect(await kakao(next, noEmail)).toBe("/");
    expect(staffAccess(await loadViewer(t.auth, t.db, next.headers()), "operator")).toBe("verify_2fa");
  });

  it("비밀번호가 있는 계정은 지금처럼 비밀번호를 받아야 켠다", async () => {
    const user = await createVerifiedUser(t);
    const browser = new Browser(t.auth);
    await browser.call("POST", "/sign-in/email", user);
    expect((await browser.call("POST", "/two-factor/enable", { issuer: "AIONIT" })).status).toBe(400);
    expect((await browser.call("POST", "/two-factor/enable", { password: user.password })).status).toBe(200);
  });
});
