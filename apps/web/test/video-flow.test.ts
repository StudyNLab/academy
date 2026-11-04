// 자체 서버 영상 (개발계획 M4): 나눠 올리기 ➔ worker 변환(HLS · AES-128 · 자막) ➔ 영상 자리 연결 ➔
// 재생 토큰(수강권 확인) ➔ 조각 요청 확인 ➔ 키 서버(수강권 다시 확인) ➔ 시청 기록 · 진도. 교재 그림 접근도 수강권으로.
import { execFileSync, spawnSync } from "node:child_process";
import { createDecipheriv } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MEDIA_TOKEN_TTL_SEC, mediaPaths, signMediaToken } from "@aionit/core/media";
import { eq, schema } from "@aionit/db";
import { createMemoryStore } from "@aionit/storage";
import { processCourseVersion } from "../../worker/src/content";
import { transcodeVideo } from "../../worker/src/video";
import { buildZip, normalEntries } from "../../../packages/content/test/fixtures";
import { isPreviewImage, previewChapter } from "@/server/catalog";
import {
  createCourse,
  createInstructor,
  publishVersion,
  setPreviewRule,
  uploadPackage,
} from "@/server/courses";
import { grantEntitlement, revokeEntitlement } from "@/server/entitlements";
import { learnChapter, learnerContext, LearningError, recordHeartbeats } from "@/server/learning";
import type { Viewer } from "@/server/viewer";
import {
  addSubtitle,
  checkMediaRequest,
  completeVideoUpload,
  hlsKeyFor,
  learnerPlayback,
  linkHosted,
  removeVideo,
  startVideoUpload,
  uploadVideoPart,
  VIDEO_PART_BYTES,
} from "@/server/videos";
import { resetDb, setupTestAuth } from "./helpers";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const t = setupTestAuth();
const store = createMemoryStore();
const media = createMemoryStore();
const SECRET = t.env.BETTER_AUTH_SECRET;
const ORIGIN = "http://localhost:3000";
const queued: string[] = [];
const deps = { db: t.db, store, media, enqueueVideo: async (id: string) => void queued.push(id) };

let work: string;
let clip: Buffer;
beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), "aionit-video-test-"));
  if (!hasFfmpeg) return;
  // 4초짜리 시험 영상 (360p, 소리 있음)
  execFileSync("ffmpeg", [
    ...["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=10"],
    ...["-f", "lavfi", "-i", "sine=frequency=440", "-t", "4"],
    ...["-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", join(work, "clip.mp4")],
  ]);
  clip = readFileSync(join(work, "clip.mp4"));
});
afterAll(async () => {
  rmSync(work, { recursive: true, force: true });
  await t.close();
});

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
let operator: Viewer;
let learner: Viewer;
let other: Viewer;
let courseId: string;
let versionId: string;

beforeEach(async () => {
  await resetDb(t.db);
  store.objects.clear();
  media.objects.clear();
  queued.length = 0;
  const [op, member, stranger] = await t.db
    .insert(schema.users)
    .values([
      { email: "op@example.com", nickname: "운영하는사람", emailVerified: true },
      { email: "me@example.com", nickname: "배우는사람", emailVerified: true },
      { email: "you@example.com", nickname: "지나가는사람", emailVerified: true },
    ])
    .returning();
  operatorId = op!.id;
  operator = viewerOf(op!.id, ["operator"]);
  learner = viewerOf(member!.id);
  other = viewerOf(stranger!.id);
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
  versionId = version.id;
  await processCourseVersion({ db: t.db, store }, version.id);
  await publishVersion(t.db, version.id, { actorId: operatorId });
});

const grant = () =>
  grantEntitlement(t.db, { actorId: operatorId, userId: learner.userId, courseId, days: 30, reason: "베타" });

/** 올리기 ➔ 다 올림 ➔ 변환 ➔ ch01_lab01 자리에 연결 */
async function readyVideo() {
  const started = await startVideoUpload(deps, {
    courseId,
    title: "실습 1 시연",
    fileName: "ch01_lab01.mp4",
    size: clip.length,
    actorId: operatorId,
  });
  await uploadVideoPart(deps, started.id, 1, clip);
  await completeVideoUpload(deps, started.id, { actorId: operatorId });
  await transcodeVideo({ db: t.db, store, media, secret: SECRET }, started.id);
  const [slot] = await t.db.select().from(schema.videoSlots).where(eq(schema.videoSlots.key, "ch01_lab01"));
  await linkHosted(t.db, slot!.id, { assetId: started.id, actorId: operatorId });
  return started.id;
}

describe.skipIf(!hasFfmpeg)("자체 서버 영상", () => {
  it("올리기: 조각 크기 · 번호 · 영상 파일인지 확인하고, 다 올리면 변환 대기열에 넣는다", async () => {
    const big = await startVideoUpload(deps, {
      courseId,
      title: "큰 영상",
      fileName: "big.mp4",
      size: VIDEO_PART_BYTES + 10,
      actorId: operatorId,
    });
    expect(big.parts).toBe(2);
    await expect(uploadVideoPart(deps, big.id, 1, Buffer.alloc(10))).rejects.toMatchObject({
      code: "BAD_PART",
    });
    await expect(uploadVideoPart(deps, big.id, 3, Buffer.alloc(10))).rejects.toMatchObject({
      code: "BAD_PART",
    });
    await expect(uploadVideoPart(deps, big.id, 1, Buffer.alloc(VIDEO_PART_BYTES))).rejects.toMatchObject({
      code: "NOT_VIDEO",
    });
    await expect(completeVideoUpload(deps, big.id, { actorId: operatorId })).rejects.toMatchObject({
      code: "INCOMPLETE",
    });
    await expect(
      startVideoUpload(deps, { courseId, title: "x", fileName: "a.exe", size: 10, actorId: operatorId }),
    ).rejects.toMatchObject({ code: "BAD_TYPE" });

    const small = await startVideoUpload(deps, {
      courseId,
      title: "작은 영상",
      fileName: "clip.mp4",
      size: clip.length,
      actorId: operatorId,
    });
    await uploadVideoPart(deps, small.id, 1, clip);
    await completeVideoUpload(deps, small.id, { actorId: operatorId });
    expect(queued).toEqual([small.id]);
    const [asset] = await t.db.select().from(schema.videoAssets).where(eq(schema.videoAssets.id, small.id));
    expect(asset).toMatchObject({ status: "uploaded", uploadId: null });
    expect(store.objects.get(asset!.originalKey)?.body.equals(clip)).toBe(true);
  });

  it("변환: 암호화 HLS (키 주소 · 조각 · 대표 재생 목록) + 진행 100%, 키는 감싸서 DB 에", async () => {
    const id = await readyVideo();
    const [asset] = await t.db.select().from(schema.videoAssets).where(eq(schema.videoAssets.id, id));
    expect(asset).toMatchObject({ status: "ready", progress: 100, width: 640, height: 360, durationSec: 4 });
    expect(asset!.renditions.map((r) => r.name)).toEqual(["360p"]);
    const paths = mediaPaths(id);
    const master = media.objects.get(paths.master)!.body.toString();
    expect(master).toContain("RESOLUTION=640x360");
    expect(master).toContain("360p/index.m3u8");
    const playlist = media.objects.get(`${paths.hls}360p/index.m3u8`)!.body.toString();
    expect(playlist).toContain(`#EXT-X-KEY:METHOD=AES-128,URI="/api/v1/hls/keys/${id}"`);
    const segment = media.objects.get(`${paths.hls}360p/seg_00000.ts`)!.body;
    expect(segment[0]).not.toBe(0x47); // 암호화돼서 TS 시작 바이트가 아니다
    const [key] = await t.db.select().from(schema.hlsKeys).where(eq(schema.hlsKeys.id, asset!.keyId!));
    expect(key!.keySealed.length).toBe(45);
  });

  it("재생: 수강권이 있어야 토큰, 토큰으로 조각, 키는 같은 사람 + 지금 수강권일 때만. 회수하면 키를 못 받는다", async () => {
    const id = await readyVideo();
    const input = { courseId, videoKey: "ch01_lab01" };
    await expect(learnerPlayback(t.db, learner, input, SECRET)).rejects.toBeInstanceOf(LearningError);

    const entitlementId = await grant();
    const playback = await learnerPlayback(t.db, learner, input, SECRET);
    expect(playback.src).toBe(`/media/v/${id}/hls/master.m3u8`);
    expect(playback.mark).toMatch(/^배우는사람 · #[0-9A-F]{6}$/);

    // 조각 요청 확인 (Caddy forward_auth)
    const seg = `/media/v/${id}/hls/360p/seg_00000.ts`;
    expect(checkMediaRequest(SECRET, playback.token, seg)).toEqual({
      ok: true,
      objectPath: `v/${id}/hls/360p/seg_00000.ts`,
    });
    expect(checkMediaRequest(SECRET, null, seg)).toEqual({ ok: false, status: 401 });
    const later = new Date(Date.now() + (MEDIA_TOKEN_TTL_SEC + 1) * 1000);
    expect(checkMediaRequest(SECRET, playback.token, seg, later)).toEqual({ ok: false, status: 401 });
    const otherAsset = signMediaToken(SECRET, {
      userId: learner.userId,
      assetId: "00000000-0000-7000-8000-000000000000",
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(checkMediaRequest(SECRET, otherAsset, seg)).toEqual({ ok: false, status: 403 });
    expect(checkMediaRequest(SECRET, playback.token, `/media/v/${id}/../secret`)).toEqual({
      ok: false,
      status: 404,
    });
    expect(checkMediaRequest(SECRET, playback.token, `/media/v/${id}/hls/x.mp4`)).toEqual({
      ok: false,
      status: 404,
    });

    // 키: 받은 키로 조각을 풀면 TS 가 나온다
    const key = await hlsKeyFor(t.db, learner, id, playback.token, SECRET);
    expect(key?.length).toBe(16);
    const playlist = media.objects.get(`v/${id}/hls/360p/index.m3u8`)!.body.toString();
    const iv = Buffer.from(playlist.match(/IV=0x([0-9a-f]{32})/i)![1]!, "hex");
    const decipher = createDecipheriv("aes-128-cbc", key!, iv);
    const plain = Buffer.concat([
      decipher.update(media.objects.get(`v/${id}/hls/360p/seg_00000.ts`)!.body),
      decipher.final(),
    ]);
    expect(plain[0]).toBe(0x47);

    // 남의 토큰 · 로그인 안 함 · 만료 토큰은 키를 못 받는다
    expect(await hlsKeyFor(t.db, other, id, playback.token, SECRET)).toBeNull();
    expect(await hlsKeyFor(t.db, null, id, playback.token, SECRET)).toBeNull();
    expect(await hlsKeyFor(t.db, learner, id, playback.token, SECRET, later)).toBeNull();
    // 수강권이 없는 사람이 스스로 만든 토큰이 있어도 (비밀값을 안다고 해도) 키는 수강권을 다시 본다
    const forged = signMediaToken(SECRET, {
      userId: other.userId,
      assetId: id,
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(await hlsKeyFor(t.db, other, id, forged, SECRET)).toBeNull();

    await revokeEntitlement(t.db, { actorId: operatorId, id: entitlementId, reason: "시험" });
    expect(await hlsKeyFor(t.db, learner, id, playback.token, SECRET)).toBeNull();
    await expect(learnerPlayback(t.db, learner, input, SECRET)).rejects.toBeInstanceOf(LearningError);

    // 운영자는 수강권 없이 본다
    const staff = await learnerPlayback(t.db, operator, input, SECRET);
    expect(await hlsKeyFor(t.db, operator, id, staff.token, SECRET)).not.toBeNull();
  });

  it("학습 화면: 수강생은 플레이어 자리, 미리보기는 🔒 카드. 시청 90% ➔ 영상 완료 조건에 든다", async () => {
    await readyVideo();
    await setPreviewRule(t.db, courseId, { chapterKey: "ch01", scope: "whole", actorId: operatorId });
    const preview = await previewChapter(t.db, "ai-agent-basics", "ch01");
    expect(preview!.html).toContain("🔒 수강생 전용 영상입니다");
    expect(preview!.html).not.toContain("hosted-video");

    await grant();
    const page = await learnChapter(t.db, learner, "ai-agent-basics", "ch01", ORIGIN);
    if (page.kind !== "ok") throw new Error(page.kind);
    expect(page.html).toContain('<div class="hosted-video" data-hosted-key="ch01_lab01"></div>');
    expect(page.videos).toEqual([expect.objectContaining({ key: "ch01_lab01", hosted: true, done: false })]);

    const ctx = await learnerContext(t.db, learner, courseId);
    const result = await recordHeartbeats(t.db, learner.userId, ctx, [
      {
        chapterKey: "ch01",
        kind: "video",
        at: new Date().toISOString(),
        videoKey: "ch01_lab01",
        ranges: [[0, 3.8]],
        positionSec: 4,
        durationSec: 4,
      },
    ]);
    expect(result.accepted).toBe(1);
    expect(result.chapters[0]!.videosDone).toEqual(["ch01_lab01"]);
  });

  it("자막: srt ➔ WebVTT 를 영상 폴더에. 재생 정보에 자막 주소가 실린다", async () => {
    const id = await readyVideo();
    const result = await addSubtitle(deps, id, {
      srt: Buffer.from("1\n00:00:00,500 --> 00:00:02,000\n안녕하세요\n"),
      fileName: "ch01_lab01.srt",
      actorId: operatorId,
    });
    expect(result.cues).toBe(1);
    expect(media.objects.get(mediaPaths(id).subtitle("ko"))!.body.toString()).toContain(
      "00:00:00.500 --> 00:00:02.000",
    );
    await grant();
    const playback = await learnerPlayback(t.db, learner, { courseId, videoKey: "ch01_lab01" }, SECRET);
    expect(playback.subtitles).toEqual([{ lang: "ko", label: "한국어", src: `/media/v/${id}/subs/ko.vtt` }]);
    expect(checkMediaRequest(SECRET, playback.token, `/media/v/${id}/subs/ko.vtt`).ok).toBe(true);
  });

  it("연결된 영상은 지우지 않는다. 끊고 지우면 원본 · 변환 결과 · 키가 모두 지워진다", async () => {
    const id = await readyVideo();
    await expect(removeVideo(deps, id, { actorId: operatorId })).rejects.toMatchObject({ code: "LINKED" });
    const [slot] = await t.db.select().from(schema.videoSlots).where(eq(schema.videoSlots.key, "ch01_lab01"));
    await linkHosted(t.db, slot!.id, { assetId: null, actorId: operatorId });
    const [asset] = await t.db.select().from(schema.videoAssets).where(eq(schema.videoAssets.id, id));
    await removeVideo(deps, id, { actorId: operatorId });
    expect([...media.objects.keys()].filter((k) => k.startsWith(`v/${id}/`))).toEqual([]);
    expect(store.objects.has(asset!.originalKey)).toBe(false);
    expect(await t.db.select().from(schema.hlsKeys)).toEqual([]);
    const audit = await t.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.targetId, id));
    expect(audit.map((a) => a.action).sort()).toEqual(["video.remove", "video.upload"]);
  });

  it("다른 과정의 영상 · 변환 전 영상은 연결할 수 없다", async () => {
    const started = await startVideoUpload(deps, {
      courseId,
      title: "아직",
      fileName: "a.mp4",
      size: clip.length,
      actorId: operatorId,
    });
    const [slot] = await t.db.select().from(schema.videoSlots).where(eq(schema.videoSlots.key, "ch01_lab01"));
    await expect(
      linkHosted(t.db, slot!.id, { assetId: started.id, actorId: operatorId }),
    ).rejects.toMatchObject({
      code: "NOT_READY",
    });
  });
});

describe("교재 그림 접근 (수강권으로 좁힘)", () => {
  it("무료 미리보기에 나오는 그림만 누구나 (미리보기 범위를 바꾸면 바로 반영)", async () => {
    expect(await isPreviewImage(t.db, courseId, versionId, "images/fig1-01.png")).toBe(false);
    await setPreviewRule(t.db, courseId, { chapterKey: "ch01", scope: "whole", actorId: operatorId });
    expect(await isPreviewImage(t.db, courseId, versionId, "images/fig1-01.png")).toBe(true);
    expect(await isPreviewImage(t.db, courseId, versionId, "images/fig2-01.png")).toBe(false);
    // Section 일부만 열면 그 Section 의 그림만 (fig1-01 은 sec-1 에 있다)
    await setPreviewRule(t.db, courseId, {
      chapterKey: "ch01",
      scope: "sections",
      sectionIds: ["sec-2"],
      actorId: operatorId,
    });
    expect(await isPreviewImage(t.db, courseId, versionId, "images/fig1-01.png")).toBe(false);
  });
});
