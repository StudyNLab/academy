// 교재 올리기 ➔ 검사 · 처리(worker) ➔ 공개 ➔ 목록 · 상세 · 무료 미리보기 ➔ 새 버전 비교 ➔ 되돌리기 (개발계획 M2)
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, schema } from "@aionit/db";
import { createMemoryStore } from "@aionit/storage";
import { processCourseVersion } from "../../worker/src/content";
import { buildZip, chapterHtml, normalEntries } from "../../../packages/content/test/fixtures";
import { adminVersion, contentAsset, courseDetail, listCatalog, previewChapter } from "@/server/catalog";
import {
  addAttachment,
  CourseError,
  createCourse,
  createInstructor,
  linkYoutube,
  publishVersion,
  rejectVersion,
  removeInstructor,
  rollbackToVersion,
  setPreviewRule,
  uploadPackage,
} from "@/server/courses";
import { resetDb, setupTestAuth } from "./helpers";

const t = setupTestAuth();
const store = createMemoryStore();
const queued: string[] = [];
const deps = { db: t.db, store, enqueueContent: async (id: string) => void queued.push(id) };
afterAll(() => t.close());

let actorId: string;
beforeEach(async () => {
  await resetDb(t.db);
  store.objects.clear();
  queued.length = 0;
  const [user] = await t.db
    .insert(schema.users)
    .values({ email: "op@example.com", nickname: "운영하는사람", emailVerified: true })
    .returning();
  actorId = user!.id;
});

async function setupCourse() {
  const instructor = await createInstructor(t.db, { displayName: "홍길동", actorId });
  return createCourse(t.db, {
    slug: "ai-agent-basics",
    title: "AI Agent 개발 · 초급",
    field: "ai",
    level: "초급",
    ownerInstructorId: instructor.id,
    summary: "LLM API 로 나만의 Agent 를 만든다",
    descriptionMd: "",
    audienceMd: "",
    requirementsMd: "LLM API 키",
    inSubscription: true,
    actorId,
  });
}

/** 올리고 worker 처리까지 */
async function uploadAndProcess(courseId: string, entries?: Awaited<ReturnType<typeof normalEntries>>) {
  const zip = buildZip(entries ?? (await normalEntries()));
  const version = await uploadPackage(deps, { courseId, zip, fileName: "pkg.zip", actorId });
  expect(queued.at(-1)).toBe(version.id);
  await processCourseVersion({ db: t.db, store }, version.id);
  const [row] = await t.db
    .select()
    .from(schema.courseVersions)
    .where(eq(schema.courseVersions.id, version.id));
  return row!;
}

describe("교재 올리기 ➔ 공개", () => {
  it("검사를 통과한 버전을 공개하면 목록 · 상세에 보이고, 무료 미리보기는 정한 범위만 보인다", async () => {
    const course = await setupCourse();
    expect(await listCatalog(t.db)).toEqual([]); // 공개 전에는 목록에 없다

    const version = await uploadAndProcess(course.id);
    expect(version.status).toBe("ready");
    expect((version.validationReport as { ok: boolean }).ok).toBe(true);

    // 그림은 WebP 로 저장소에, 본문 주소는 우리 주소로
    const webps = [...store.objects.keys()].filter((k) => k.endsWith(".webp"));
    expect(webps).toHaveLength(2);
    const chapters = await t.db
      .select()
      .from(schema.chapters)
      .where(eq(schema.chapters.courseVersionId, version.id));
    expect(chapters[0]!.contentHtml).toContain(`/api/v1/content/${version.id}/images/fig`);
    // 검수 전 그림은 공개되지 않은 버전의 것
    expect((await contentAsset(t.db, version.id, "images/fig1-01.png"))?.isPublished).toBe(false);

    // 영상 자리가 과정에 생기고, 연결 안 된 것이 검수 화면에 경고로 보인다
    const review = await adminVersion(t.db, version.id);
    expect(review!.unlinked.map((u) => u.key).sort()).toEqual([
      "ch01_lab01",
      "ch01_main",
      "ch02_lab01",
      "ch02_main",
    ]);

    await publishVersion(t.db, version.id, { actorId });
    const catalog = await listCatalog(t.db);
    expect(catalog).toMatchObject([
      { slug: "ai-agent-basics", instructor: "홍길동", chapters: 2, labs: 2, freeVideos: 0 },
    ]);
    expect(await listCatalog(t.db, { field: "security" })).toEqual([]);
    expect((await contentAsset(t.db, version.id, "images/fig1-01.png"))?.isPublished).toBe(true);

    // 유튜브 연결 ➔ 무료 공개 영상 수
    const slot = (
      await t.db.select().from(schema.videoSlots).where(eq(schema.videoSlots.key, "ch01_main"))
    )[0]!;
    await expect(linkYoutube(t.db, slot.id, { url: "https://evil.example/x", actorId })).rejects.toThrow(
      CourseError,
    );
    await linkYoutube(t.db, slot.id, { url: "https://youtu.be/dQw4w9WgXcQ", actorId });
    expect((await listCatalog(t.db))[0]!.freeVideos).toBe(1);

    // 무료 미리보기: 정하지 않은 챕터는 볼 수 없다, 정한 Section 만 보인다
    expect(await previewChapter(t.db, "ai-agent-basics", "ch01")).toBeNull();
    await setPreviewRule(t.db, course.id, {
      chapterKey: "ch01",
      scope: "sections",
      sectionIds: ["sec-1"],
      actorId,
    });
    const preview = await previewChapter(t.db, "ai-agent-basics", "ch01");
    expect(preview!.html).toContain('id="sec-1"');
    expect(preview!.html).not.toContain('id="sec-2"');
    expect(preview!.toc.map((x) => x.id)).toEqual(["sec-1"]);
    await setPreviewRule(t.db, course.id, { chapterKey: "ch02", scope: "whole", actorId });
    const whole = await previewChapter(t.db, "ai-agent-basics", "ch02");
    expect(whole!.html).toContain('id="sec-2"');
    // 연결 안 된 영상 자리는 수강생 화면에 보이지 않는다
    expect(whole!.html).not.toContain("video-slot");

    const detail = await courseDetail(t.db, "ai-agent-basics");
    expect(detail!.chapters.map((c) => [c.key, c.preview?.scope ?? null])).toEqual([
      ["ch01", "sections"],
      ["ch02", "whole"],
    ]);

    const actions = (await t.db.select().from(schema.auditLogs).orderBy(schema.auditLogs.at)).map(
      (a) => a.action,
    );
    expect(actions).toEqual([
      "instructor.create",
      "course.create",
      "content.upload",
      "content.publish",
      "video.link",
      "preview.set",
      "preview.set",
    ]);
  });

  it("새 버전은 바뀐 챕터를 보여 주고, 공개 후 예전 버전으로 되돌릴 수 있다", async () => {
    const course = await setupCourse();
    const v1 = await uploadAndProcess(course.id);
    await publishVersion(t.db, v1.id, { actorId });

    const entries = (await normalEntries()).map((e) =>
      e.name === "course.json"
        ? { ...e, data: (e.data as string).replace('"0.2.0"', '"0.3.0"') }
        : e.name === "chapters/02_LLM_API_호출/content.html"
          ? { ...e, data: chapterHtml(2, "<p>보충</p>") }
          : e,
    );
    const v2 = await uploadAndProcess(course.id, entries);
    expect((v2.validationReport as { diff: unknown }).diff).toEqual([
      { key: "ch01", title: "챕터 1", change: "same" },
      { key: "ch02", title: "챕터 2", change: "changed" },
    ]);
    await publishVersion(t.db, v2.id, { actorId, note: "CH2 보충" });
    let [c] = await t.db.select().from(schema.courses).where(eq(schema.courses.id, course.id));
    expect(c!.publishedVersionId).toBe(v2.id);
    const statuses = async () =>
      Object.fromEntries((await t.db.select().from(schema.courseVersions)).map((v) => [v.version, v.status]));
    expect(await statuses()).toEqual({ "0.2.0": "archived", "0.3.0": "published" });

    await expect(rollbackToVersion(t.db, v2.id, { actorId })).rejects.toThrow("예전에 공개했던");
    await rollbackToVersion(t.db, v1.id, { actorId });
    [c] = await t.db.select().from(schema.courses).where(eq(schema.courses.id, course.id));
    expect(c!.publishedVersionId).toBe(v1.id);
    expect(await statuses()).toEqual({ "0.2.0": "published", "0.3.0": "archived" });
  });
});

describe("올리기 검사", () => {
  it("다른 과정의 패키지 · zip 아님 · 공개한 버전 다시 올리기는 거부", async () => {
    const course = await setupCourse();
    const other = (await normalEntries()).map((e) =>
      e.name === "course.json"
        ? { ...e, data: (e.data as string).replace("ai-agent-basics", "linux-log") }
        : e,
    );
    await expect(
      uploadPackage(deps, { courseId: course.id, zip: buildZip(other), fileName: "x.zip", actorId }),
    ).rejects.toMatchObject({
      code: "COURSE_ID_MISMATCH",
    });
    await expect(
      uploadPackage(deps, { courseId: course.id, zip: Buffer.from("%PDF-1.7"), fileName: "x.zip", actorId }),
    ).rejects.toMatchObject({ code: "NOT_ZIP" });

    const v1 = await uploadAndProcess(course.id);
    await publishVersion(t.db, v1.id, { actorId });
    await expect(uploadAndProcess(course.id)).rejects.toMatchObject({ code: "VERSION_PUBLISHED" });
  });

  it("공개 전의 같은 버전은 덮어쓴다", async () => {
    const course = await setupCourse();
    const first = await uploadAndProcess(course.id);
    const second = await uploadAndProcess(course.id);
    const versions = await t.db.select().from(schema.courseVersions);
    expect(versions.map((v) => v.id)).toEqual([second.id]);
    expect(first.id).not.toBe(second.id);
  });

  it("경로 탈출 패키지는 올릴 때 바로 거부", async () => {
    const course = await setupCourse();
    const entries = [...(await normalEntries()), { name: "chapters/../../evil", data: "x" }];
    await expect(
      uploadPackage(deps, { courseId: course.id, zip: buildZip(entries), fileName: "x.zip", actorId }),
    ).rejects.toMatchObject({ code: "ZIP_PATH_TRAVERSAL" });
    expect(await t.db.select().from(schema.courseVersions)).toEqual([]);
  });

  it("검사에서 걸린 버전은 invalid 로 남고 공개할 수 없다, 반려할 수 있다", async () => {
    const course = await setupCourse();
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
    const entries = (await normalEntries()).map((e) =>
      e.name === "images/fig1-01.png" ? { ...e, data: svg } : e,
    );
    const version = await uploadAndProcess(course.id, entries);
    expect(version.status).toBe("invalid");
    expect((version.validationReport as { errors: { code: string }[] }).errors[0]!.code).toBe(
      "IMAGE_BAD_FORMAT",
    );
    expect(await t.db.select().from(schema.chapters)).toEqual([]);
    await expect(publishVersion(t.db, version.id, { actorId })).rejects.toMatchObject({ code: "NOT_READY" });
    await rejectVersion(t.db, version.id, { actorId, reason: "경로 탈출 파일" });
    const [row] = await t.db
      .select()
      .from(schema.courseVersions)
      .where(eq(schema.courseVersions.id, version.id));
    expect(row).toMatchObject({ status: "rejected", reviewNote: "경로 탈출 파일" });
  });

  it("첨부 자료는 zip 만, 챕터별로 등록한다", async () => {
    const course = await setupCourse();
    const zip = buildZip([{ name: "lab/main.py", data: "print(1)" }]);
    const row = await addAttachment(deps, {
      courseId: course.id,
      chapterKey: "ch01",
      title: "실습 1 파일",
      file: zip,
      fileName: "lab1.zip",
      actorId,
    });
    expect(row.chapterKey).toBe("ch01");
    await expect(
      addAttachment(deps, {
        courseId: course.id,
        chapterKey: null,
        title: "x",
        file: Buffer.from("MZ..."),
        fileName: "x.exe",
        actorId,
      }),
    ).rejects.toMatchObject({ code: "NOT_ZIP" });
  });
});

describe("강사", () => {
  it("맡은 과정이 없는 강사만 지우고, 기록을 남긴다", async () => {
    const course = await setupCourse();
    const spare = await createInstructor(t.db, { displayName: "잘못 만든 강사", actorId });

    await expect(removeInstructor(t.db, course.ownerInstructorId, { actorId })).rejects.toMatchObject({
      code: "INSTRUCTOR_IN_USE",
      status: 409,
    });
    await removeInstructor(t.db, spare.id, { actorId });
    const left = await t.db.select().from(schema.instructors);
    expect(left.map((i) => i.displayName)).toEqual(["홍길동"]);
    const [audit] = await t.db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, "instructor.remove"));
    expect(audit?.targetId).toBe(spare.id);
    await expect(removeInstructor(t.db, spare.id, { actorId })).rejects.toBeInstanceOf(CourseError);
  });
});
