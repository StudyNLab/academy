// 로그인 보호: 계정 잠금 · IP 횟수 제한 · 로그인 기록, 역할 · 2단계 인증 · 관리자 진입, 12시간 세션, 이용 정지
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, schema } from "@aionit/db";
import { setRole, setUserStatus } from "@/server/members";
import { loadViewer, staffAccess } from "@/server/viewer";
import { Browser, createVerifiedUser, resetDb, setupTestAuth, totpFromUri } from "./helpers";

const t = setupTestAuth();
afterAll(() => t.close());
beforeEach(async () => {
  await resetDb(t.db);
  t.mails.length = 0;
});
afterEach(() => vi.useRealTimers());

const loginLogs = () => t.db.select().from(schema.loginLogs).orderBy(schema.loginLogs.at);

describe("계정 잠금 (15분 안에 10번 틀리면 15분)", () => {
  it("10번 틀리면 맞는 비밀번호도 막고, 15분이 지나면 풀린다", async () => {
    const user = await createVerifiedUser(t);
    // IP 횟수 제한과 섞이지 않게 시도마다 다른 IP
    for (let i = 0; i < 10; i++) {
      const wrong = await new Browser(t.auth).call("POST", "/sign-in/email", {
        email: user.email,
        password: `Wrong-${i}-pass`,
      });
      expect(wrong.status).toBe(401);
    }
    const locked = await new Browser(t.auth).call("POST", "/sign-in/email", {
      email: user.email,
      password: user.password,
    });
    expect(locked.status).toBe(429);
    expect(locked.body.code).toBe("ACCOUNT_LOCKED");
    expect(locked.body.message).toContain("15분 뒤");

    const logs = await loginLogs();
    expect(logs.filter((l) => l.result === "fail_password")).toHaveLength(10);
    expect(logs.at(-1)!.result).toBe("blocked_locked");
    // 기록에 이메일은 남지 않는다 (HMAC 만)
    expect(JSON.stringify(logs)).not.toContain(user.email);
    expect(new Set(logs.map((l) => l.identifierHash)).size).toBe(1);

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 16 * 60_000);
    const later = await new Browser(t.auth).call("POST", "/sign-in/email", {
      email: user.email,
      password: user.password,
    });
    expect(later.status).toBe(200);
    expect((await loginLogs()).at(-1)!.result).toBe("success");
  });

  it("로그인에 성공하면 그 전 실패는 세지 않는다", async () => {
    const user = await createVerifiedUser(t);
    for (let i = 0; i < 9; i++)
      await new Browser(t.auth).call("POST", "/sign-in/email", {
        email: user.email,
        password: "Wrong-pass-1",
      });
    expect((await new Browser(t.auth).call("POST", "/sign-in/email", user)).status).toBe(200);
    for (let i = 0; i < 9; i++)
      await new Browser(t.auth).call("POST", "/sign-in/email", {
        email: user.email,
        password: "Wrong-pass-1",
      });
    expect((await new Browser(t.auth).call("POST", "/sign-in/email", user)).status).toBe(200);
  });
});

describe("IP 횟수 제한", () => {
  it("같은 IP 에서 1분에 10번이 넘으면 막는다", async () => {
    const browser = new Browser(t.auth, "10.77.0.1");
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      statuses.push(
        (
          await browser.call("POST", "/sign-in/email", {
            email: `x${i}@example.com`,
            password: "Wrong-pass-1",
          })
        ).status,
      );
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
    // 다른 IP 는 영향 없음
    expect(
      (
        await new Browser(t.auth, "10.77.0.2").call("POST", "/sign-in/email", {
          email: "y@example.com",
          password: "Wrong-pass-1",
        })
      ).status,
    ).toBe(401);
  });
});

describe("운영자 · 강사: 2단계 인증 필수, 세션 12시간", () => {
  async function operator() {
    const user = await createVerifiedUser(t);
    const [row] = await t.db.select().from(schema.users).where(eq(schema.users.email, user.email));
    await setRole(t.db, {
      actorId: null,
      userId: row!.id,
      role: "operator",
      grant: true,
      reason: "첫 운영자",
    });
    return { ...user, id: row!.id };
  }

  it("2단계 인증을 켜기 전에는 관리자 화면에 못 들어가고, 켜면 들어간다", async () => {
    const op = await operator();
    const browser = new Browser(t.auth);
    expect((await browser.call("POST", "/sign-in/email", op)).status).toBe(200);

    // 세션은 12시간까지만
    const [session] = await t.db.select().from(schema.sessions);
    expect(session!.expiresAt.getTime() - session!.createdAt.getTime()).toBeLessThanOrEqual(
      12 * 3600_000 + 5_000,
    );

    let viewer = await loadViewer(t.auth, t.db, browser.headers());
    expect(viewer!.roles).toEqual(["operator"]);
    expect(staffAccess(viewer, "operator")).toBe("setup_2fa");
    expect(staffAccess(viewer, "instructor")).toBe("forbidden");

    const enable = await browser.call("POST", "/two-factor/enable", { password: op.password });
    expect(enable.status).toBe(200);
    const uri = enable.body.totpURI as string;
    expect(enable.body.backupCodes).toHaveLength(10);
    // 아직 코드를 확인하지 않았으므로 켜지지 않음
    viewer = await loadViewer(t.auth, t.db, browser.headers());
    expect(staffAccess(viewer, "operator")).toBe("setup_2fa");

    const verify = await browser.call("POST", "/two-factor/verify-totp", { code: totpFromUri(uri) });
    expect(verify.status).toBe(200);
    viewer = await loadViewer(t.auth, t.db, browser.headers());
    expect(viewer!.twoFactorEnabled).toBe(true);
    expect(staffAccess(viewer, "operator")).toBe("ok");

    // 2단계 인증 비밀값은 암호화해 저장한다
    const [secret] = await t.db.select().from(schema.twoFactors);
    expect(uri).not.toContain(secret!.secret);

    // 다시 로그인하면 비밀번호 다음에 OTP 를 받는다
    await browser.call("POST", "/sign-out");
    const login = await browser.call("POST", "/sign-in/email", op);
    expect(login.body.twoFactorRedirect).toBe(true);
    expect(await loadViewer(t.auth, t.db, browser.headers())).toBeNull();
    const wrong = await browser.call("POST", "/two-factor/verify-totp", { code: "000000" });
    expect(wrong.status).toBe(401);
    const ok = await browser.call("POST", "/two-factor/verify-totp", { code: totpFromUri(uri) });
    expect(ok.status).toBe(200);
    expect(staffAccess(await loadViewer(t.auth, t.db, browser.headers()), "operator")).toBe("ok");

    const results = (await loginLogs()).map((l) => l.result);
    expect(results).toContain("two_factor_required");
    expect(results).toContain("fail_two_factor");
    expect((await loginLogs()).every((l) => l.privileged === "yes")).toBe(true);
  });

  it("OTP 를 거치지 않은 세션(구글 · 카카오 로그인 등)은 관리자 화면 전에 OTP 를 다시 받는다 · 5번 틀리면 잠금", async () => {
    const op = await operator();
    const browser = new Browser(t.auth);
    await browser.call("POST", "/sign-in/email", op);
    const uri = (await browser.call("POST", "/two-factor/enable", { password: op.password })).body
      .totpURI as string;
    await browser.call("POST", "/two-factor/verify-totp", { code: totpFromUri(uri) });

    // OTP 통과 표시가 없는 세션 = 소셜 로그인 세션과 같은 상태
    await t.db.update(schema.sessions).set({ mfaVerifiedAt: null });
    expect(staffAccess(await loadViewer(t.auth, t.db, browser.headers()), "operator")).toBe("verify_2fa");

    for (let i = 0; i < 5; i++) {
      expect((await browser.call("POST", "/two-factor/verify-totp", { code: "000000" })).status).toBe(401);
      browser.ip = `10.88.0.${i + 1}`; // IP 제한이 아니라 계정 제한을 확인
    }
    const locked = await browser.call("POST", "/two-factor/verify-totp", { code: totpFromUri(uri) });
    expect(locked.status).toBe(429);
    expect(locked.body.code).toBe("TWO_FACTOR_LOCKED");

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 16 * 60_000);
    browser.ip = "10.88.1.1";
    // 시계를 옮겼으니 그 시각의 코드
    const ok = await browser.call("POST", "/two-factor/verify-totp", { code: totpFromUri(uri, Date.now()) });
    expect(ok.status).toBe(200);
    expect(staffAccess(await loadViewer(t.auth, t.db, browser.headers()), "operator")).toBe("ok");
  });

  it("로그인하고 12시간이 지나면 활동해도 세션이 끝난다 (수강생은 그대로)", async () => {
    const op = await operator();
    const learner = await createVerifiedUser(t, { email: "member@example.com", name: "수강생하나" });
    const opBrowser = new Browser(t.auth);
    await opBrowser.call("POST", "/sign-in/email", op);
    const learnerBrowser = new Browser(t.auth);
    await learnerBrowser.call("POST", "/sign-in/email", learner);

    const later = new Date(Date.now() + 12 * 3600_000 + 1000);
    expect(await loadViewer(t.auth, t.db, opBrowser.headers(), later)).toBeNull();
    expect(await loadViewer(t.auth, t.db, learnerBrowser.headers(), later)).not.toBeNull();
    // 끝난 세션은 DB 에서도 지운다
    const sessions = await t.db.select().from(schema.sessions);
    expect(sessions).toHaveLength(1);
  });

  it("역할을 주거나 거두면 기록이 남고, 그 사람은 다시 로그인해야 한다", async () => {
    const op = await operator();
    const member = await createVerifiedUser(t, { email: "teacher@example.com", name: "강의하는사람" });
    const [row] = await t.db.select().from(schema.users).where(eq(schema.users.email, member.email));
    const browser = new Browser(t.auth);
    await browser.call("POST", "/sign-in/email", member);

    await setRole(t.db, {
      actorId: op.id,
      userId: row!.id,
      role: "instructor",
      grant: true,
      reason: "강사 계약",
    });
    expect(await loadViewer(t.auth, t.db, browser.headers())).toBeNull();
    await setRole(t.db, {
      actorId: op.id,
      userId: row!.id,
      role: "instructor",
      grant: false,
      reason: "계약 끝",
    });

    const audits = await t.db.select().from(schema.auditLogs).orderBy(schema.auditLogs.at);
    expect(audits.map((a) => a.action)).toEqual(["role.grant", "role.grant", "role.revoke"]);
    expect(audits[1]).toMatchObject({ actorId: op.id, targetId: row!.id });
    expect(audits[2]!.after).toMatchObject({ role: "instructor", active: false, reason: "계약 끝" });
  });
});

describe("이용 정지", () => {
  it("정지하면 세션이 끝나고 로그인할 수 없다 · 기록이 남는다", async () => {
    const member = await createVerifiedUser(t);
    const [row] = await t.db.select().from(schema.users).where(eq(schema.users.email, member.email));
    const browser = new Browser(t.auth);
    await browser.call("POST", "/sign-in/email", member);

    const actorId = "01900000-0000-7000-8000-000000000001";
    await setUserStatus(t.db, { actorId, userId: row!.id, status: "suspended", reason: "결제 사기 의심" });
    expect(await loadViewer(t.auth, t.db, browser.headers())).toBeNull();
    const login = await new Browser(t.auth).call("POST", "/sign-in/email", member);
    expect(login.status).toBe(403);
    expect(login.body.code).toBe("ACCOUNT_SUSPENDED");
    expect((await loginLogs()).at(-1)!.result).toBe("fail_suspended");

    await setUserStatus(t.db, { actorId, userId: row!.id, status: "active", reason: "확인 끝" });
    expect((await new Browser(t.auth).call("POST", "/sign-in/email", member)).status).toBe(200);
    const audits = await t.db.select().from(schema.auditLogs).orderBy(schema.auditLogs.at);
    expect(audits.map((a) => a.action)).toEqual(["user.suspend", "user.unsuspend"]);
  });
});
