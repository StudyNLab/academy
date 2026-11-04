// 수강권 발급 ➔ 학습 화면 ➔ 읽은 위치 · 학습 신호 · 영상 · 실습 체크 ➔ 챕터 완료 · 진도율 ➔ 하루 집계 ➔ 탈퇴 (개발계획 M3)
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, schema } from "@aionit/db";
import { createMemoryStore } from "@aionit/storage";
import { processCourseVersion } from "../../worker/src/content";
import { aggregateLearningDay } from "../../worker/src/learning";
import { buildZip, normalEntries } from "../../../packages/content/test/fixtures";
import {
  addAttachment,
  createCourse,
  createInstructor,
  linkYoutube,
  publishVersion,
  setPreviewRule,
  uploadPackage,
} from "@/server/courses";
import { adjustEntitlement, grantEntitlement, revokeEntitlement } from "@/server/entitlements";
import type { HeartbeatInput } from "@/server/learning";
import {
  attachmentForLearner,
  learnChapter,
  learnerContext,
  LearningError,
  myClassroom,
  recordHeartbeats,
  resumeChapter,
  saveReadPosition,
  setSelfCheck,
} from "@/server/learning";
import type { Viewer } from "@/server/viewer";
import { withdrawUser } from "@/server/withdraw";
import { resetDb, setupTestAuth } from "./helpers";

const t = setupTestAuth();
const store = createMemoryStore();
const ORIGIN = "http://localhost:3000";
afterAll(() => t.close());

const viewerOf = (userId: string, roles: Viewer["roles"] = []): Viewer => ({
  userId,
  email: "x@example.com",
  nickname: "배우는사람",
  emailVerified: true,
  twoFactorEnabled: false,
  sessionId: "s",
  sessionCreatedAt: new Date(),
  mfaVerifiedAt: null,
  roles,
});

let operatorId: string;
let learner: Viewer;
let courseId: string;

beforeEach(async () => {
  await resetDb(t.db);
  store.objects.clear();
  const [op, member] = await t.db
    .insert(schema.users)
    .values([
      { email: "op@example.com", nickname: "운영하는사람", emailVerified: true },
      { email: "me@example.com", nickname: "배우는사람", emailVerified: true },
    ])
    .returning();
  operatorId = op!.id;
  learner = viewerOf(member!.id);
  const instructor = await createInstructor(t.db, { displayName: "홍길동", actorId: operatorId });
  const course = await createCourse(t.db, {
    slug: "ai-agent-basics",
    title: "AI Agent 개발 · 초급",
    field: "ai",
    level: "초급",
    ownerInstructorId: instructor.id,
    summary: "",
    descriptionMd: "",
    audienceMd: "",
    requirementsMd: "",
    inSubscription: true,
    actorId: operatorId,
  });
  courseId = course.id;
  const version = await uploadPackage(
    { db: t.db, store, enqueueContent: async () => undefined },
    { courseId, zip: buildZip(await normalEntries()), fileName: "pkg.zip", actorId: operatorId },
  );
  await processCourseVersion({ db: t.db, store }, version.id);
  await publishVersion(t.db, version.id, { actorId: operatorId });
  // ch01 챕터 영상만 유튜브 연결 (ch01_lab01 은 연결 안 함 ➔ 완료 조건에서 빠진다)
  const [main] = await t.db.select().from(schema.videoSlots).where(eq(schema.videoSlots.key, "ch01_main"));
  await linkYoutube(t.db, main!.id, { url: "https://youtu.be/dQw4w9WgXcQ", actorId: operatorId });
});

const grant = (days: number | null = 90) =>
  grantEntitlement(t.db, {
    actorId: operatorId,
    userId: learner.userId,
    courseId,
    days,
    reason: "베타 수강생",
  });

describe("수강권 (AD-08 · L-05)", () => {
  it("수강권이 없으면 L-05, 발급하면 학습 화면, 회수 · 만료하면 다시 L-05. 작업은 모두 기록에 남는다", async () => {
    expect(await learnChapter(t.db, learner, "ai-agent-basics", "ch01", ORIGIN)).toMatchObject({
      kind: "denied",
      access: { kind: "learner", access: { ok: false, reason: "none" } },
      hasPreview: false,
    });
    await setPreviewRule(t.db, courseId, { chapterKey: "ch01", scope: "whole", actorId: operatorId });
    expect(await learnChapter(t.db, null, "ai-agent-basics", "ch01", ORIGIN)).toMatchObject({
      kind: "denied",
      hasPreview: true,
    });

    const id = await grant(90);
    const [row] = await t.db.select().from(schema.entitlements).where(eq(schema.entitlements.id, id));
    // 90일 = 오늘부터 90일 뒤 그날 끝(KST 자정)까지
    expect(row!.endsAt!.getTime() - Date.now()).toBeGreaterThan(90 * 86_400_000);
    expect(row!.endsAt!.getTime() - Date.now()).toBeLessThanOrEqual(91 * 86_400_000);

    const page = await learnChapter(t.db, learner, "ai-agent-basics", "ch01", ORIGIN);
    expect(page.kind).toBe("ok");
    if (page.kind !== "ok") return;
    // 영상은 시청 기록용 API 를 켜고, 실습 Section 끝에 스스로 확인 자리가 생긴다
    expect(page.html).toContain('data-video-key="ch01_main"');
    expect(page.html).toContain("enablejsapi=1");
    expect(page.html).toContain('<div class="self-check-slot" data-section="sec-2"></div></section>');
    expect(page.videos.map((v) => v.key)).toEqual(["ch01_main"]);
    expect(page.labs).toEqual([
      { sectionId: "sec-2", title: "실습 1", items: [{ id: "c1", text: "결과가 보인다", checked: false }] },
    ]);

    // 시작보다 앞선 끝나는 날은 받지 않는다
    await expect(
      adjustEntitlement(t.db, {
        actorId: operatorId,
        id,
        endsAt: new Date(row!.startsAt.getTime() - 86_400_000),
        reason: "잘못",
      }),
    ).rejects.toThrow("시작보다 뒤");
    await t.db
      .update(schema.entitlements)
      .set({ startsAt: new Date(Date.now() - 10 * 86_400_000) })
      .where(eq(schema.entitlements.id, id));
    await adjustEntitlement(t.db, {
      actorId: operatorId,
      id,
      endsAt: new Date(Date.now() - 1000),
      reason: "기간 확인",
    });
    expect(await learnChapter(t.db, learner, "ai-agent-basics", "ch02", ORIGIN)).toMatchObject({
      kind: "denied",
      access: { access: { ok: false, reason: "expired" } },
    });
    await adjustEntitlement(t.db, { actorId: operatorId, id, endsAt: null, reason: "무제한으로" });
    expect((await learnChapter(t.db, learner, "ai-agent-basics", "ch02", ORIGIN)).kind).toBe("ok");
    await revokeEntitlement(t.db, { actorId: operatorId, id, reason: "테스트 회수" });
    expect((await learnChapter(t.db, learner, "ai-agent-basics", "ch02", ORIGIN)).kind).toBe("denied");
    await expect(learnerContext(t.db, learner, courseId)).rejects.toThrow(LearningError);

    const audits = await t.db.select({ action: schema.auditLogs.action }).from(schema.auditLogs);
    expect(audits.map((a) => a.action).filter((a) => a.startsWith("entitlement."))).toEqual([
      "entitlement.grant",
      "entitlement.adjust",
      "entitlement.adjust",
      "entitlement.revoke",
    ]);
  });

  it("운영자 · 그 과정 강사 본인은 수강권 없이 볼 수 있다", async () => {
    const page = await learnChapter(
      t.db,
      viewerOf(operatorId, ["operator"]),
      "ai-agent-basics",
      "ch01",
      ORIGIN,
    );
    expect(page).toMatchObject({ kind: "ok", staff: true });
    const [ins] = await t.db.select().from(schema.instructors);
    await t.db
      .update(schema.instructors)
      .set({ userId: learner.userId })
      .where(eq(schema.instructors.id, ins!.id));
    const own = await learnChapter(
      t.db,
      viewerOf(learner.userId, ["instructor"]),
      "ai-agent-basics",
      "ch02",
      ORIGIN,
    );
    expect(own).toMatchObject({ kind: "ok", staff: true });
  });
});

describe("진도 · 학습 신호", () => {
  // 고정 시각 (KST 2026-11-04 12:00) 기준 신호
  const now = new Date("2026-11-04T03:00:00Z");
  const at = (secAgo: number) => new Date(now.getTime() - secAgo * 1000).toISOString();
  const text = (secAgo: number, chapterKey = "ch01"): HeartbeatInput => ({
    chapterKey,
    kind: "text",
    at: at(secAgo),
    activeSec: 30,
  });
  const video = (secAgo: number, s: number, e: number): Extract<HeartbeatInput, { kind: "video" }> => ({
    chapterKey: "ch01",
    kind: "video",
    at: at(secAgo),
    videoKey: "ch01_main",
    ranges: [[s, e]],
    positionSec: e,
    durationSec: 600,
  });

  it("끝까지 읽기 + 최소 시간 + 영상 90% + 체크 ➔ 챕터 완료, 진도율 · 이어서 보기 · 첫 이용", async () => {
    const id = await grant(null);
    const ctx = await learnerContext(t.db, learner, courseId);

    // 끝까지 내려갔지만 머문 시간이 모자라면 교재 완료가 아니다
    expect(
      await saveReadPosition(t.db, learner.userId, ctx, {
        chapterKey: "ch01",
        sectionId: "sec-2",
        readRatio: 1,
        reachedEnd: true,
      }),
    ).toMatchObject({ textDone: false, completed: false });
    // 짧은 챕터는 최소 1분: 30초 신호 두 번 (같은 칸의 두 번째 탭은 세지 않는다)
    let result = await recordHeartbeats(t.db, learner.userId, ctx, [text(900), text(899), text(860)], now);
    expect(result.accepted).toBe(3);
    expect(result.chapters[0]).toMatchObject({ textDone: true, completed: false });

    // 24시간 지난 신호 · 연결 안 된 영상 · 한 번에 너무 긴 구간은 받지 않는다
    result = await recordHeartbeats(
      t.db,
      learner.userId,
      ctx,
      [text(25 * 3600), { ...video(800, 0, 30), videoKey: "ch01_lab01" }, video(790, 0, 300)],
      now,
    );
    expect(result.accepted).toBe(0);

    // 영상 540초(90%)를 30초 신호 9번으로 (2배속: 30초에 60초씩)
    const beats = Array.from({ length: 9 }, (_, i) => video(600 - i * 30, i * 60, (i + 1) * 60));
    result = await recordHeartbeats(t.db, learner.userId, ctx, beats, now);
    expect(result.chapters[0]).toMatchObject({ videosDone: ["ch01_main"], completed: false });
    const [watch] = await t.db.select().from(schema.videoWatch);
    expect(watch).toMatchObject({ watchedRanges: [[0, 540]], lastPositionSec: 540, durationSec: 600 });

    await expect(
      setSelfCheck(t.db, learner.userId, ctx, {
        chapterKey: "ch01",
        sectionId: "sec-2",
        itemId: "nope",
        checked: true,
      }),
    ).rejects.toThrow(LearningError);
    expect(
      await setSelfCheck(t.db, learner.userId, ctx, {
        chapterKey: "ch01",
        sectionId: "sec-2",
        itemId: "c1",
        checked: true,
      }),
    ).toMatchObject({ completed: true });
    // 완료 뒤 체크를 풀어도 완료는 그대로
    expect(
      await setSelfCheck(t.db, learner.userId, ctx, {
        chapterKey: "ch01",
        sectionId: "sec-2",
        itemId: "c1",
        checked: false,
      }),
    ).toMatchObject({ completed: true });

    const [classroom] = await myClassroom(t.db, learner.userId);
    expect(classroom).toMatchObject({
      slug: "ai-agent-basics",
      active: true,
      percent: 50,
      resume: { key: "ch01" },
    });
    expect(await resumeChapter(t.db, learner, "ai-agent-basics")).toBe("ch01");
    const page = await learnChapter(t.db, learner, "ai-agent-basics", "ch01", ORIGIN);
    expect(page).toMatchObject({
      kind: "ok",
      percent: 50,
      progress: { lastSectionId: "sec-2", completed: true },
    });

    // 첫 재생 = 이용함
    const [ent] = await t.db.select().from(schema.entitlements).where(eq(schema.entitlements.id, id));
    expect(ent!.firstUsedAt).toEqual(now);
  });

  it("첨부 받기는 기록을 남기고, 수강권이 없으면 받을 수 없다", async () => {
    const zip = buildZip([{ name: "a.txt", data: "hi" }]);
    const attachment = await addAttachment(
      { db: t.db, store },
      {
        courseId,
        chapterKey: "ch01",
        title: "실습 파일",
        file: zip,
        fileName: "lab.zip",
        actorId: operatorId,
      },
    );
    await expect(attachmentForLearner(t.db, learner, attachment.id)).rejects.toThrow(LearningError);
    await grant();
    const row = await attachmentForLearner(t.db, learner, attachment.id);
    expect(row.name).toBe("lab.zip");
    const downloads = await t.db.select().from(schema.attachmentDownloads);
    expect(downloads).toMatchObject([{ userId: learner.userId, attachmentId: attachment.id }]);
    const [ent] = await t.db.select().from(schema.entitlements);
    expect(ent!.firstUsedAt).not.toBeNull();
  });

  it("하루 집계: 영상 · 교재 시간, 다시 돌려도 같은 값, 운영자는 0", async () => {
    await grant();
    const ctx = await learnerContext(t.db, learner, courseId);
    await recordHeartbeats(
      t.db,
      learner.userId,
      ctx,
      [text(300), text(270), video(240, 0, 60), text(235)],
      now,
    );
    const opCtx = await learnerContext(t.db, viewerOf(operatorId, ["operator"]), courseId);
    await t.db
      .insert(schema.userRoles)
      .values({ userId: operatorId, role: "operator", grantedBy: null, reason: "테스트" });
    await recordHeartbeats(t.db, operatorId, opCtx, [text(300)], now);

    expect(await aggregateLearningDay(t.db, "2026-11-04")).toEqual({ day: "2026-11-04", rows: 2 });
    await aggregateLearningDay(t.db, "2026-11-04");
    const rows = await t.db.select().from(schema.learningTimeDaily);
    expect(rows).toHaveLength(2);
    // 교재 60초 (영상 칸의 교재 신호는 빼고) + 영상 60초
    expect(rows.find((r) => r.userId === learner.userId)).toMatchObject({
      date: "2026-11-04",
      videoSec: 60,
      textSec: 60,
      effectiveSec: 120,
      ruleVersion: "2026-11-v1",
    });
    expect(rows.find((r) => r.userId === operatorId)).toMatchObject({ textSec: 30, effectiveSec: 0 });
  });

  it("탈퇴하면 학습 기록을 지우고, 하루 학습 시간은 누구인지만 지우고, 수강권은 회수한다", async () => {
    await grant();
    const ctx = await learnerContext(t.db, learner, courseId);
    await recordHeartbeats(t.db, learner.userId, ctx, [text(300), video(240, 0, 60)], now);
    await setSelfCheck(t.db, learner.userId, ctx, {
      chapterKey: "ch01",
      sectionId: "sec-2",
      itemId: "c1",
      checked: true,
    });
    await aggregateLearningDay(t.db, "2026-11-04");

    await withdrawUser(t.db, learner.userId);
    const mine = <T extends { userId: unknown }>(rows: T[]) =>
      rows.filter((r) => r.userId === learner.userId);
    expect(mine(await t.db.select().from(schema.chapterProgress))).toEqual([]);
    expect(mine(await t.db.select().from(schema.videoWatch))).toEqual([]);
    expect(mine(await t.db.select().from(schema.selfChecks))).toEqual([]);
    expect(mine(await t.db.select().from(schema.learningHeartbeats))).toEqual([]);
    const daily = await t.db.select().from(schema.learningTimeDaily);
    expect(daily).toMatchObject([{ userId: null, effectiveSec: 90 }]);
    const ents = await t.db
      .select()
      .from(schema.entitlements)
      .where(and(eq(schema.entitlements.userId, learner.userId)));
    expect(ents.every((e) => e.revokedAt && e.revokeReason === "회원 탈퇴")).toBe(true);
  });
});
