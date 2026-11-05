// 정책 문서 버전 · 시행일 관리 (AD-12, M10): 새 버전은 알릴 기간 뒤 시행, 시행 전에만 지울 수 있고, 시행된 버전은
// 고치거나 지울 수 없다 (DB 트리거). 시행 예정 버전은 지금 버전을 바꾸지 않는다.
// policy_documents 는 resetDb 가 비우지 않으므로 이 시험이 만든 버전은 끝에 지운다.
import { afterAll, describe, expect, it } from "vitest";
import { eq, schema, sql } from "@aionit/db";
import { currentPolicies } from "@/server/consents";
import {
  createPolicyVersion,
  deletePolicyVersion,
  earliestEffectiveOn,
  policyHistory,
  policyOverview,
} from "@/server/policies";
import { SupportError } from "@/server/support-error";
import { setupTestAuth } from "./helpers";

const t = setupTestAuth();
const ACTOR = "01900000-0000-7000-8000-000000000001";
const RUN = Date.now().toString(36);
const made: string[] = [];

afterAll(async () => {
  // 시행 예정 버전만 만들었으므로 트리거가 지우기를 허락한다. 시험용 운영자 기록도 함께
  for (const id of made)
    await t.db
      .delete(schema.policyDocuments)
      .where(eq(schema.policyDocuments.id, id))
      .catch(() => undefined);
  await t.close();
});

const code = (p: Promise<unknown>) =>
  p.then(
    () => "OK",
    (e: unknown) => (e instanceof SupportError ? e.code : String(e)),
  );

const NOW = new Date("2026-11-05T10:00:00+09:00");

describe("정책 문서 새 버전", () => {
  it("시행일은 알릴 기간 뒤부터 (약관 7일, 불리하면 30일, 마케팅은 내일)", async () => {
    expect(earliestEffectiveOn("terms", false, NOW)).toBe("2026-11-12");
    expect(earliestEffectiveOn("terms", true, NOW)).toBe("2026-12-05");
    expect(earliestEffectiveOn("marketing", false, NOW)).toBe("2026-11-06");
    // 한국 시각으로 날짜를 센다 (UTC 로는 아직 전날)
    expect(earliestEffectiveOn("terms", false, new Date("2026-11-05T00:30:00+09:00"))).toBe("2026-11-12");

    const base = {
      kind: "terms" as const,
      title: "이용약관",
      bodyMd: "## 제1조\n\n시험 본문입니다.",
      actorId: ACTOR,
    };
    expect(
      await code(
        createPolicyVersion(
          t.db,
          { ...base, version: `t-${RUN}-a`, effectiveOn: "2026-11-11", adverse: false },
          NOW,
        ),
      ),
    ).toBe("TOO_SOON");
    expect(
      await code(
        createPolicyVersion(
          t.db,
          { ...base, version: `t-${RUN}-a`, effectiveOn: "2026-11-20", adverse: true },
          NOW,
        ),
      ),
    ).toBe("TOO_SOON");
  });

  it("게시하면 시행 예정으로 보이고, 지금 버전은 그대로. 동의 필수 여부는 종류가 정한다. 작업은 기록에 남는다", async () => {
    const before = (await currentPolicies(t.db, ["terms"], NOW)).get("terms")!;
    const row = await createPolicyVersion(
      t.db,
      {
        kind: "terms",
        version: `t-${RUN}-b`,
        title: "이용약관",
        bodyMd: "## 제1조\n\n바뀐 본문입니다.",
        effectiveOn: "2099-01-01",
        adverse: false,
        actorId: ACTOR,
      },
      NOW,
    );
    made.push(row.id);
    expect(row).toMatchObject({ required: true, effectiveFrom: new Date("2099-01-01T00:00:00+09:00") });
    expect((await currentPolicies(t.db, ["terms"], NOW)).get("terms")!.id).toBe(before.id);

    const history = await policyHistory(t.db, "terms", NOW);
    expect(history[0]).toMatchObject({ id: row.id, state: "scheduled" });
    expect(history.filter((h) => h.state === "current")).toHaveLength(1);
    const overview = await policyOverview(t.db, NOW);
    expect(overview.find((o) => o.kind === "terms")!.next?.id).toBeDefined();

    const [audit] = await t.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.targetId, row.id));
    expect(audit).toMatchObject({ action: "policy.create", actorId: ACTOR });

    // 같은 버전 이름 · 같은 시행일은 한 번만
    const again = {
      kind: "terms" as const,
      title: "이용약관",
      bodyMd: "## 제1조\n\n또 다른 본문입니다.",
      adverse: false,
      actorId: ACTOR,
    };
    expect(
      await code(
        createPolicyVersion(t.db, { ...again, version: `t-${RUN}-b`, effectiveOn: "2099-02-01" }, NOW),
      ),
    ).toBe("VERSION_TAKEN");
    expect(
      await code(
        createPolicyVersion(t.db, { ...again, version: `t-${RUN}-c`, effectiveOn: "2099-01-01" }, NOW),
      ),
    ).toBe("SAME_DAY");
  });

  it("시행 전 버전은 지울 수 있고, 시행된 버전은 앱도 DB 도 고치거나 지우지 못한다", async () => {
    const row = await createPolicyVersion(
      t.db,
      {
        kind: "privacy_policy",
        version: `t-${RUN}-d`,
        title: "개인정보처리방침",
        bodyMd: "## 1. 처리하는 개인정보\n\n시험 본문입니다.",
        effectiveOn: "2099-03-01",
        adverse: false,
        actorId: ACTOR,
      },
      NOW,
    );
    expect(row.required).toBe(false);
    await deletePolicyVersion(t.db, { id: row.id, actorId: ACTOR }, NOW);
    expect(
      await t.db.select().from(schema.policyDocuments).where(eq(schema.policyDocuments.id, row.id)),
    ).toEqual([]);

    const current = (await currentPolicies(t.db, ["terms"]))!.get("terms")!;
    expect(await code(deletePolicyVersion(t.db, { id: current.id, actorId: ACTOR }))).toBe("IN_FORCE");
    await expect(
      t.db.execute(sql`update policy_documents set body_md = 'x' where id = ${current.id}`),
    ).rejects.toThrow();
    await expect(t.db.execute(sql`delete from policy_documents where id = ${current.id}`)).rejects.toThrow();
    // 시행 예정 버전도 고칠 수는 없다 (지우고 다시 만든다)
    const scheduled = made[0]!;
    await expect(
      t.db.execute(sql`update policy_documents set body_md = 'x' where id = ${scheduled}`),
    ).rejects.toThrow();
  });
});
