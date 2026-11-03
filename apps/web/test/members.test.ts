// 회원 탈퇴(개인정보가 남지 않는다), 닉네임 30일 규칙, 마케팅 동의 철회, 기록 테이블은 덧붙이기만
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, schema, sql } from "@aionit/db";
import { latestConsents, setMarketingConsent } from "@/server/consents";
import { changeNickname, MemberError } from "@/server/members";
import { recordPiiAccess, writeAudit } from "@/server/records";
import { withdrawUser } from "@/server/withdraw";
import { purgeExpiredRecords } from "../../worker/src/retention";
import { Browser, createVerifiedUser, resetDb, setupTestAuth, tokenFromMail } from "./helpers";

const t = setupTestAuth();
afterAll(() => t.close());
beforeEach(async () => {
  await resetDb(t.db);
  t.mails.length = 0;
});

async function userId(email: string) {
  const [row] = await t.db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email));
  return row!.id;
}

/** public 스키마의 모든 글자 · JSON 열에서 needle 을 찾는다 */
async function findEverywhere(needle: string): Promise<string[]> {
  const columns = await t.db.execute<{ table_name: string; column_name: string }>(sql`
    select table_name, column_name from information_schema.columns
    where table_schema = 'public' and data_type in ('text', 'character varying', 'jsonb', 'json')`);
  // 열마다 따로 물으면 느리므로 한 번에 묻는다
  const checks = columns.map(
    ({ table_name, column_name }) =>
      sql`select ${table_name + "." + column_name} as hit where exists (select 1 from ${sql.identifier(table_name)} where ${sql.identifier(column_name)}::text ilike ${"%" + needle + "%"})`,
  );
  const rows = await t.db.execute<{ hit: string }>(sql.join(checks, sql` union all `));
  const hits = rows.map((row) => row.hit);
  return hits.sort();
}

/** drizzle 은 DB 오류를 감싸서 던진다. 안쪽(cause) 메시지를 본다 */
async function dbError(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const inner = (error as { cause?: Error }).cause ?? (error as Error);
    return inner.message;
  }
  return "(오류 없음)";
}

describe("회원 탈퇴", () => {
  it("탈퇴 후 DB 어디에도 이메일 · 닉네임이 남지 않고, 다시 로그인할 수 없다", async () => {
    const user = await createVerifiedUser(t, { email: "leaving.person@example.com", name: "떠나는사람" });
    const id = await userId(user.email);
    const browser = new Browser(t.auth);
    await browser.call("POST", "/sign-in/email", user);
    await browser.call("POST", "/request-password-reset", {
      email: user.email,
      redirectTo: "/reset-password",
    });
    await new Browser(t.auth).call("POST", "/sign-in/email", {
      email: user.email,
      password: "Wrong-pass-77",
    });
    await t.db
      .insert(schema.emailLogs)
      .values({ toUserId: id, toEmail: user.email, template: "verify-email", status: "sent" });
    await setMarketingConsent(t.db, id, true, "10.1.1.1");

    expect(await findEverywhere(user.email)).toEqual(["email_logs.to_email", "users.email"]);

    await withdrawUser(t.db, id, browser.headers());

    expect(await findEverywhere(user.email)).toEqual([]);
    expect(await findEverywhere("leaving.person")).toEqual([]);
    expect(await findEverywhere("떠나는사람")).toEqual([]);

    const [row] = await t.db.select().from(schema.users).where(eq(schema.users.id, id));
    expect(row).toMatchObject({ status: "withdrawn", nickname: null, emailVerified: false });
    expect(row!.email).toMatch(/@withdrawn\.invalid$/);
    for (const table of [schema.sessions, schema.authAccounts, schema.twoFactors] as const) {
      expect(await t.db.select().from(table).where(eq(table.userId, id))).toHaveLength(0);
    }
    // 동의 기록은 남기되 IP 는 지운다 (언제 무엇에 동의했는지만)
    const consents = await t.db.select().from(schema.userConsents).where(eq(schema.userConsents.userId, id));
    expect(consents.length).toBeGreaterThan(0);
    expect(consents.every((c) => c.ip === null)).toBe(true);

    // 세션이 끝났고, 같은 이메일 · 비밀번호로 로그인할 수 없다
    expect((await browser.call("GET", "/get-session")).body.user).toBeUndefined();
    expect((await new Browser(t.auth).call("POST", "/sign-in/email", user)).status).toBe(401);
    // 남은 재설정 링크도 쓸 수 없다
    const token = tokenFromMail(t.mails, "reset-password", user.email);
    expect(
      (await browser.call("POST", "/reset-password", { token, newPassword: "Revived-Pass-321" })).status,
    ).toBe(400);

    const [audit] = await t.db.select().from(schema.auditLogs);
    expect(audit).toMatchObject({ action: "user.withdraw", actorId: id, targetId: id });
  });

  it("탈퇴한 이메일 · 닉네임으로 다시 가입할 수 있다 (새 회원)", async () => {
    const user = await createVerifiedUser(t);
    const id = await userId(user.email);
    await withdrawUser(t.db, id);
    t.mails.length = 0;
    const again = await createVerifiedUser(t);
    expect(await userId(again.email)).not.toBe(id);
  });
});

describe("닉네임 바꾸기", () => {
  it("30일에 한 번, 고유하게", async () => {
    const a = await createVerifiedUser(t, { email: "a@example.com", name: "첫째" });
    await createVerifiedUser(t, { email: "b@example.com", name: "둘째" });
    const id = await userId(a.email);
    const now = new Date();

    await expect(changeNickname(t.db, id, "둘째", now)).rejects.toMatchObject({ code: "NICKNAME_TAKEN" });
    expect(await changeNickname(t.db, id, " 새이름 ", now)).toBe("새이름");
    await expect(
      changeNickname(t.db, id, "또새이름", new Date(now.getTime() + 29 * 86_400_000)),
    ).rejects.toThrow(MemberError);
    expect(await changeNickname(t.db, id, "또새이름", new Date(now.getTime() + 30 * 86_400_000))).toBe(
      "또새이름",
    );
    await expect(
      changeNickname(t.db, id, "관리자", new Date(now.getTime() + 90 * 86_400_000)),
    ).rejects.toMatchObject({
      code: "INVALID_NICKNAME",
    });
  });
});

describe("마케팅 수신 동의", () => {
  it("켜고 끈 기록이 모두 남고, 가장 최근 값이 현재 상태다", async () => {
    const user = await createVerifiedUser(t);
    const id = await userId(user.email);
    expect((await latestConsents(t.db, id)).get("marketing")!.agreed).toBe(false);
    await setMarketingConsent(t.db, id, true, null);
    await setMarketingConsent(t.db, id, false, null);
    expect((await latestConsents(t.db, id)).get("marketing")!.agreed).toBe(false);
    const rows = await t.db.select().from(schema.userConsents).where(eq(schema.userConsents.userId, id));
    expect(rows).toHaveLength(5); // 가입 3 + 켜기 + 끄기
  });
});

describe("기록 테이블은 덧붙이기만", () => {
  it("고치거나 지울 수 없다 (DB 트리거)", async () => {
    await writeAudit(t.db, { actorId: null, action: "test.action" });
    await recordPiiAccess(t.db, {
      actorId: "01900000-0000-7000-8000-000000000001",
      subjectUserId: null,
      fields: ["email"],
      purpose: "시험",
    });
    expect(await dbError(t.db.execute(sql`update audit_logs set action = 'changed'`))).toMatch(/덧붙이기만/);
    expect(await dbError(t.db.execute(sql`delete from audit_logs`))).toMatch(/덧붙이기만/);
    expect(await dbError(t.db.execute(sql`update pii_access_logs set purpose = 'x'`))).toMatch(/덧붙이기만/);
    expect(await dbError(t.db.execute(sql`delete from pii_access_logs`))).toMatch(/덧붙이기만/);
    expect(await dbError(t.db.execute(sql`truncate audit_logs`))).toMatch(/비울 수 없습니다/);
  });

  it("보관 기간이 지난 것만 정리 작업이 지운다 (회원 6개월 · 운영자 2년)", async () => {
    const day = 86_400_000;
    const now = Date.now();
    const at = (daysAgo: number) => new Date(now - daysAgo * day);
    await t.db.insert(schema.loginLogs).values([
      { method: "email", result: "success", privileged: "no", at: at(190) },
      { method: "email", result: "success", privileged: "no", at: at(170) },
      { method: "email", result: "success", privileged: "yes", at: at(400) },
      { method: "email", result: "success", privileged: "yes", at: at(740) },
    ]);
    await t.db.insert(schema.auditLogs).values([
      { action: "old", at: at(740) },
      { action: "recent", at: at(10) },
    ]);
    const result = await purgeExpiredRecords(t.db);
    expect(result.loginLogs).toBe(2);
    expect(result.auditLogs).toBe(1);
    const left = await t.db.select().from(schema.loginLogs);
    expect(left).toHaveLength(2);
    expect((await t.db.select().from(schema.auditLogs)).map((a) => a.action)).toEqual(["recent"]);
  });
});
