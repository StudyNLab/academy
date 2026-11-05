// 앱 DB 계정 권한 분리 (M10, 0012 마이그레이션). 서버의 web · worker 는 aionit_app 으로 접속한다.
// 테스트 DB 는 소유자 계정이라, 트랜잭션 안에서 `set local role aionit_app` 으로 앱 계정이 되어 본다.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { RETENTION } from "@aionit/core";
import { schema, sql } from "@aionit/db";
import { purgeExpiredRecords } from "../../worker/src/retention";
import { resetDb, setupTestAuth } from "./helpers";

const t = setupTestAuth();
afterAll(() => t.close());
beforeEach(() => resetDb(t.db));

const DAY = 86_400_000;
const ACTOR = "01900000-0000-7000-8000-000000000001";

/** 앱 계정으로 sql 을 실행해 본다. 결과는 늘 되돌린다. 오류면 메시지, 아니면 null */
async function asApp(...statements: ReturnType<typeof sql>[]): Promise<string | null> {
  let message: string | null = null;
  await t.db
    .transaction(async (tx) => {
      await tx.execute(sql`set local role aionit_app`);
      try {
        for (const statement of statements) await tx.execute(statement);
      } catch (error) {
        const e = error as { message: string; cause?: { message?: string } };
        message = e.cause?.message ?? e.message;
      }
      throw new Error("rollback");
    })
    .catch((error: Error) => {
      if (error.message !== "rollback") throw error;
    });
  return message;
}

describe("앱 계정 aionit_app", () => {
  it("기록 테이블: 읽고 넣을 수는 있지만 고치거나 지울 수 없다 (트리거를 끄는 설정을 해도)", async () => {
    expect(await asApp(sql`insert into audit_logs (action) values ('app.write')`)).toBeNull();
    expect(await asApp(sql`select count(*) from login_logs`)).toBeNull();
    for (const statement of [
      sql`update audit_logs set action = 'x'`,
      sql`delete from login_logs`,
      sql`delete from pii_access_logs`,
      sql`update payouts set amount = 0`,
      sql`delete from orders`,
      sql`delete from payments`,
      sql`delete from inquiries`,
      sql`update inquiry_messages set body = 'x'`,
      sql`truncate sessions`,
    ])
      expect(await asApp(statement)).toMatch(/permission denied/);
    // 트리거의 정리 작업 표시를 켜도 권한이 없어 못 지운다
    expect(
      await asApp(sql`select set_config('aionit.retention_purge', 'on', true)`, sql`delete from audit_logs`),
    ).toMatch(/permission denied/);
  });

  it("표를 만들거나 바꾸지 못한다", async () => {
    expect(await asApp(sql`create table public.app_made (x int)`)).toMatch(/permission denied/);
    expect(await asApp(sql`alter table users add column x int`)).toMatch(/must be owner/);
    expect(await asApp(sql`drop table audit_logs`)).toMatch(/must be owner/);
  });

  it("보통 테이블은 읽기 · 넣기 · 고치기 · 지우기가 된다", async () => {
    expect(await asApp(sql`update users set nickname = nickname`)).toBeNull();
    expect(await asApp(sql`delete from sessions`)).toBeNull();
    expect(await asApp(sql`delete from billing_key_deletions`)).toBeNull();
  });

  it("지우지 않는 트리거가 걸린 표는 모두 앱 계정에도 그 권한이 없다 (새 기록 테이블에 REVOKE 를 빠뜨리면 여기서 걸린다)", async () => {
    const rows = await t.db.execute<{ table: string; fn: string; updates: boolean }>(sql`
      select distinct c.relname as table, p.proname as fn, (t.tgtype & 16) <> 0 as updates
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
      join pg_proc p on p.oid = t.tgfoid
      where not t.tgisinternal
        and p.proname in ('aionit_append_only', 'aionit_no_delete', 'aionit_keep_record')`);
    expect(rows.length).toBeGreaterThanOrEqual(15);
    const missing: string[] = [];
    for (const row of rows) {
      const [priv] = await t.db.execute<{ del: boolean; upd: boolean; trunc: boolean }>(sql`
        select has_table_privilege('aionit_app', ${`public.${row.table}`}, 'DELETE') as del,
               has_table_privilege('aionit_app', ${`public.${row.table}`}, 'UPDATE') as upd,
               has_table_privilege('aionit_app', ${`public.${row.table}`}, 'TRUNCATE') as trunc`);
      if (priv!.del) missing.push(`${row.table}: DELETE`);
      if (priv!.trunc) missing.push(`${row.table}: TRUNCATE`);
      if (row.updates && row.fn !== "aionit_no_delete" && priv!.upd) missing.push(`${row.table}: UPDATE`);
    }
    expect(missing).toEqual([]);
  });

  it("보관 기간 정리는 함수로만, DB 시각 기준으로 (기간은 core RETENTION 과 같다)", async () => {
    const now = Date.now();
    const at = (ms: number, plusDays: number) => new Date(now - ms + plusDays * DAY);
    await t.db.insert(schema.loginLogs).values([
      { method: "email", result: "success", privileged: "no", at: at(RETENTION.loginLogsMemberMs, -1) },
      { method: "email", result: "success", privileged: "no", at: at(RETENTION.loginLogsMemberMs, 1) },
      { method: "email", result: "success", privileged: "yes", at: at(RETENTION.loginLogsPrivilegedMs, -1) },
      { method: "email", result: "success", privileged: "yes", at: at(RETENTION.loginLogsPrivilegedMs, 1) },
    ]);
    await t.db.insert(schema.auditLogs).values([
      { action: "old", at: at(RETENTION.auditLogsMs, -1) },
      { action: "keep", at: at(RETENTION.auditLogsMs, 1) },
    ]);
    await t.db.insert(schema.piiAccessLogs).values([
      { actorId: ACTOR, purpose: "old", fields: ["email"], at: at(RETENTION.piiAccessLogsMs, -1) },
      { actorId: ACTOR, purpose: "keep", fields: ["email"], at: at(RETENTION.piiAccessLogsMs, 1) },
    ]);

    // 앱 계정으로 함수를 부를 수 있다
    expect(await asApp(sql`select aionit_purge_protected_records()`)).toBeNull();
    // 먼 미래를 넘겨도 기록 테이블은 DB 시각으로 정리한다
    const result = await purgeExpiredRecords(t.db, new Date(now + 10 * 365 * DAY));
    expect(result).toMatchObject({ loginLogs: 2, auditLogs: 1, piiAccessLogs: 1 });
    expect(await t.db.select().from(schema.loginLogs)).toHaveLength(2);
    expect((await t.db.select().from(schema.auditLogs)).map((r) => r.action)).toEqual(["keep"]);
    expect((await t.db.select().from(schema.piiAccessLogs)).map((r) => r.purpose)).toEqual(["keep"]);
  });

  it("작업 대기열(pg-boss) 스키마는 앱 계정 것이다", async () => {
    const [row] = await t.db.execute<{ owner: string }>(
      sql`select pg_get_userbyid(nspowner) as owner from pg_namespace where nspname = 'pgboss'`,
    );
    expect(row?.owner).toBe("aionit_app");
  });
});
