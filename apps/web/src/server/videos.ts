// 자체 서버 영상 (AD-05 · M4, docs/기술설계.md 5.2): 나눠 올리기 ➔ 변환 대기 · 자막 · 영상 자리 연결 · 지우기,
// 그리고 재생: 재생 토큰 발급(수강권 확인) · 조각 요청 확인(Caddy forward_auth) · 키 서버(수강권 다시 확인).
import { createHash, randomUUID } from "node:crypto";
import {
  MEDIA_TOKEN_TTL_SEC,
  mediaPaths,
  memberTag,
  openHlsKey,
  signMediaToken,
  srtToVtt,
  verifyMediaToken,
} from "@aionit/core/media";
import type { Db } from "@aionit/db";
import { and, asc, desc, eq, inArray, schema } from "@aionit/db";
import type { FileStore } from "@aionit/storage";
import { CourseError } from "./courses";
import { canLearn, viewAccess } from "./entitlements";
import { learnerContext } from "./learning";
import { writeAudit } from "./records";
import type { Viewer } from "./viewer";

export interface VideoDeps {
  db: Db;
  store: FileStore;
  media: FileStore;
  enqueueVideo: (assetId: string) => Promise<void>;
}

interface Actor {
  actorId: string;
  headers?: Headers | null;
}

/** 조각 크기. 마지막 조각 말고는 이 크기 그대로 (S3 는 5MB 이상이어야 한다) */
export const VIDEO_PART_BYTES = 16 * 1024 * 1024;
/** 올릴 수 있는 원본 크기 (1시간 녹화 원본이 보통 1 ~ 4GB) */
export const MAX_VIDEO_BYTES = 8 * 1024 * 1024 * 1024;
const VIDEO_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  webm: "video/webm",
};
export const MAX_SUBTITLE_BYTES = 2 * 1024 * 1024;

const partCount = (size: number) => Math.ceil(size / VIDEO_PART_BYTES);

async function loadAsset(db: Db, assetId: string) {
  const [asset] = await db.select().from(schema.videoAssets).where(eq(schema.videoAssets.id, assetId));
  if (!asset) throw new CourseError("NOT_FOUND", "영상을 찾을 수 없습니다.", 404);
  return asset;
}

// ---- 올리기 (운영자) ----

export async function startVideoUpload(
  deps: Pick<VideoDeps, "db" | "store">,
  input: { courseId: string; title: string; fileName: string; size: number } & Actor,
) {
  const { db, store } = deps;
  const ext = input.fileName.split(".").pop()?.toLowerCase() ?? "";
  const contentType = VIDEO_TYPES[ext];
  if (!contentType) throw new CourseError("BAD_TYPE", "mp4 · mov · mkv · webm 영상만 올릴 수 있습니다.");
  if (!Number.isInteger(input.size) || input.size <= 0)
    throw new CourseError("BAD_SIZE", "파일 크기를 확인해 주세요.");
  if (input.size > MAX_VIDEO_BYTES)
    throw new CourseError("TOO_LARGE", "영상은 8GB 까지 올릴 수 있습니다.", 413);
  const [course] = await db.select().from(schema.courses).where(eq(schema.courses.id, input.courseId));
  if (!course) throw new CourseError("NOT_FOUND", "과정을 찾을 수 없습니다.", 404);
  const id = randomUUID();
  const originalKey = `videos/${course.id}/${id}.${ext}`;
  const uploadId = await store.multipart.start(originalKey, contentType);
  const [row] = await db
    .insert(schema.videoAssets)
    .values({
      courseId: course.id,
      title: input.title.trim(),
      originalName: input.fileName.slice(0, 200),
      sizeBytes: input.size,
      originalKey,
      uploadId,
      createdBy: input.actorId,
    })
    .returning();
  await writeAudit(db, {
    actorId: input.actorId,
    action: "video.upload",
    targetType: "video_asset",
    targetId: row!.id,
    after: { courseId: course.id, title: row!.title, size: input.size, file: row!.originalName },
    headers: input.headers,
  });
  return { id: row!.id, partBytes: VIDEO_PART_BYTES, parts: partCount(input.size) };
}

/** 영상 파일 첫 바이트 확인 (확장자만 믿지 않는다): mp4 · mov 는 ftyp, mkv · webm 은 EBML */
function looksLikeVideo(head: Buffer): boolean {
  return (
    head.subarray(4, 8).toString("latin1") === "ftyp" ||
    head.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
  );
}

export async function uploadVideoPart(
  deps: Pick<VideoDeps, "db" | "store">,
  assetId: string,
  partNumber: number,
  body: Buffer,
) {
  const asset = await loadAsset(deps.db, assetId);
  if (asset.status !== "uploading" || !asset.uploadId)
    throw new CourseError("NOT_UPLOADING", "올리기가 이미 끝났거나 취소된 영상입니다.", 409);
  const total = partCount(asset.sizeBytes);
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > total)
    throw new CourseError("BAD_PART", "조각 번호가 맞지 않습니다.");
  const expected = partNumber < total ? VIDEO_PART_BYTES : asset.sizeBytes - VIDEO_PART_BYTES * (total - 1);
  if (body.length !== expected) throw new CourseError("BAD_PART", "조각 크기가 맞지 않습니다.");
  if (partNumber === 1 && !looksLikeVideo(body.subarray(0, 16)))
    throw new CourseError("NOT_VIDEO", "영상 파일이 아닙니다.");
  await deps.store.multipart.uploadPart(asset.originalKey, asset.uploadId, partNumber, body);
}

/** 이미 올라간 조각 (끊겼다가 다시 올릴 때) */
export async function uploadedParts(deps: Pick<VideoDeps, "db" | "store">, assetId: string) {
  const asset = await loadAsset(deps.db, assetId);
  if (asset.status !== "uploading" || !asset.uploadId) return { status: asset.status, parts: [] as number[] };
  const parts = await deps.store.multipart.listParts(asset.originalKey, asset.uploadId);
  return { status: asset.status, parts: parts.map((p) => p.partNumber) };
}

export async function completeVideoUpload(deps: VideoDeps, assetId: string, actor: Actor) {
  const { db, store } = deps;
  const asset = await loadAsset(db, assetId);
  if (asset.status !== "uploading" || !asset.uploadId)
    throw new CourseError("NOT_UPLOADING", "올리기가 이미 끝났거나 취소된 영상입니다.", 409);
  const parts = await store.multipart.listParts(asset.originalKey, asset.uploadId);
  const total = partCount(asset.sizeBytes);
  const size = parts.reduce((n, p) => n + p.size, 0);
  if (parts.length !== total || size !== asset.sizeBytes)
    throw new CourseError("INCOMPLETE", `아직 다 올라가지 않았습니다 (${parts.length}/${total}).`, 409);
  await store.multipart.complete(asset.originalKey, asset.uploadId);
  await db.transaction(async (tx) => {
    const [file] = await tx
      .insert(schema.files)
      .values({
        objectKey: asset.originalKey,
        mime: VIDEO_TYPES[asset.originalKey.split(".").pop() ?? ""] ?? "application/octet-stream",
        size: asset.sizeBytes,
        // 큰 파일이라 web 에서 다시 읽지 않는다. worker 가 변환하며 받을 때 확인할 수 있다
        sha256: "",
        originalName: asset.originalName,
        createdBy: actor.actorId,
      })
      .returning({ id: schema.files.id });
    await tx
      .update(schema.videoAssets)
      .set({ status: "uploaded", uploadId: null, originalFileId: file!.id, progress: 0 })
      .where(eq(schema.videoAssets.id, assetId));
  });
  await deps.enqueueVideo(assetId);
}

/** 실패했거나 인코딩 설정을 바꾼 뒤 다시 변환 */
export async function retranscodeVideo(deps: VideoDeps, assetId: string, actor: Actor) {
  const asset = await loadAsset(deps.db, assetId);
  if (asset.status !== "failed" && asset.status !== "ready")
    throw new CourseError("BUSY", "올리는 중이거나 변환 중인 영상입니다.", 409);
  // 다시 변환하는 동안에는 재생되지 않는다 (수강생 화면에서 잠시 빠진다)
  await deps.db
    .update(schema.videoAssets)
    .set({ status: "uploaded", error: null, progress: 0 })
    .where(eq(schema.videoAssets.id, assetId));
  await writeAudit(deps.db, {
    actorId: actor.actorId,
    action: "video.retranscode",
    targetType: "video_asset",
    targetId: assetId,
    headers: actor.headers,
  });
  await deps.enqueueVideo(assetId);
}

export async function addSubtitle(
  deps: Pick<VideoDeps, "db" | "store" | "media">,
  assetId: string,
  input: { srt: Buffer; fileName: string; lang?: string } & Actor,
) {
  const { db } = deps;
  const asset = await loadAsset(db, assetId);
  if (input.srt.length > MAX_SUBTITLE_BYTES)
    throw new CourseError("TOO_LARGE", "자막은 2MB 까지입니다.", 413);
  let converted: { vtt: string; cues: number };
  try {
    converted = srtToVtt(input.srt.toString("utf8"));
  } catch (error) {
    throw new CourseError("BAD_SUBTITLE", (error as Error).message);
  }
  const lang = input.lang ?? "ko";
  const srtKey = `videos/${asset.courseId}/${asset.id}-subtitle-${lang}-${randomUUID()}.srt`;
  await deps.store.put(srtKey, input.srt, { contentType: "application/x-subrip", size: input.srt.length });
  const vttPath = mediaPaths(asset.id).subtitle(lang);
  const vtt = Buffer.from(converted.vtt, "utf8");
  await deps.media.put(vttPath, vtt, { contentType: "text/vtt; charset=utf-8", size: vtt.length });
  await db.transaction(async (tx) => {
    const [file] = await tx
      .insert(schema.files)
      .values({
        objectKey: srtKey,
        mime: "application/x-subrip",
        size: input.srt.length,
        sha256: createHash("sha256").update(input.srt).digest("hex"),
        originalName: input.fileName.slice(0, 200),
        createdBy: input.actorId,
      })
      .returning({ id: schema.files.id });
    await tx
      .insert(schema.videoSubtitles)
      .values({ videoAssetId: asset.id, lang, sourceFileId: file!.id, vttPath, cues: converted.cues })
      .onConflictDoUpdate({
        target: [schema.videoSubtitles.videoAssetId, schema.videoSubtitles.lang],
        set: { sourceFileId: file!.id, vttPath, cues: converted.cues },
      });
    await writeAudit(tx, {
      actorId: input.actorId,
      action: "video.subtitle",
      targetType: "video_asset",
      targetId: asset.id,
      after: { lang, cues: converted.cues, file: input.fileName.slice(0, 200) },
      headers: input.headers,
    });
  });
  return { cues: converted.cues };
}

/** 지우기: 영상 자리에 연결돼 있으면 먼저 끊어야 한다. 변환 중이면 끝난 뒤에 */
export async function removeVideo(
  deps: Pick<VideoDeps, "db" | "store" | "media">,
  assetId: string,
  actor: Actor,
) {
  const { db } = deps;
  const asset = await loadAsset(db, assetId);
  const linked = await db
    .select({ key: schema.videoSlots.key })
    .from(schema.videoSlots)
    .where(eq(schema.videoSlots.videoAssetId, assetId));
  if (linked.length > 0)
    throw new CourseError(
      "LINKED",
      `영상 자리에 연결돼 있습니다 (${linked.map((l) => l.key).join(", ")}). 먼저 연결을 끊어 주세요.`,
      409,
    );
  if (asset.status === "transcoding")
    throw new CourseError("BUSY", "변환 중에는 지울 수 없습니다. 끝난 뒤에 지워 주세요.", 409);
  if (asset.uploadId)
    await deps.store.multipart.abort(asset.originalKey, asset.uploadId).catch(() => undefined);
  const subtitles = await db
    .select({ fileId: schema.videoSubtitles.sourceFileId, key: schema.files.objectKey })
    .from(schema.videoSubtitles)
    .innerJoin(schema.files, eq(schema.files.id, schema.videoSubtitles.sourceFileId))
    .where(eq(schema.videoSubtitles.videoAssetId, assetId));
  await deps.media.deletePrefix(mediaPaths(assetId).root);
  await deps.store.delete(asset.originalKey);
  for (const s of subtitles) await deps.store.delete(s.key);
  await db.transaction(async (tx) => {
    await tx.delete(schema.videoAssets).where(eq(schema.videoAssets.id, assetId)); // 자막 행은 함께 지워진다
    if (asset.keyId) await tx.delete(schema.hlsKeys).where(eq(schema.hlsKeys.id, asset.keyId));
    const fileIds = [asset.originalFileId, ...subtitles.map((s) => s.fileId)].filter((v): v is string => !!v);
    if (fileIds.length > 0) await tx.delete(schema.files).where(inArray(schema.files.id, fileIds));
    await writeAudit(tx, {
      actorId: actor.actorId,
      action: "video.remove",
      targetType: "video_asset",
      targetId: assetId,
      before: { courseId: asset.courseId, title: asset.title, status: asset.status },
      headers: actor.headers,
    });
  });
}

/** 영상 자리에 자체 서버 영상 연결 · 끊기 (assetId: null). 같은 과정의, 변환이 끝난 영상만 */
export async function linkHosted(db: Db, slotId: string, input: { assetId: string | null } & Actor) {
  const [slot] = await db.select().from(schema.videoSlots).where(eq(schema.videoSlots.id, slotId));
  if (!slot) throw new CourseError("NOT_FOUND", "영상 자리를 찾을 수 없습니다.", 404);
  let durationSec: number | null = null;
  if (input.assetId) {
    const asset = await loadAsset(db, input.assetId);
    if (asset.courseId !== slot.courseId)
      throw new CourseError("OTHER_COURSE", "이 과정에 올린 영상만 연결할 수 있습니다.");
    if (asset.status !== "ready")
      throw new CourseError("NOT_READY", "변환이 끝난 영상만 연결할 수 있습니다.", 409);
    durationSec = asset.durationSec;
  }
  const after = input.assetId
    ? { source: "hosted" as const, videoAssetId: input.assetId, youtubeVideoId: null, durationSec }
    : { source: "none" as const, videoAssetId: null, youtubeVideoId: null, durationSec: null };
  await db.update(schema.videoSlots).set(after).where(eq(schema.videoSlots.id, slotId));
  await writeAudit(db, {
    actorId: input.actorId,
    action: input.assetId ? "video.link" : "video.unlink",
    targetType: "video_slot",
    targetId: slotId,
    before: { source: slot.source, youtubeVideoId: slot.youtubeVideoId, videoAssetId: slot.videoAssetId },
    after: { source: after.source, videoAssetId: after.videoAssetId },
    headers: input.headers,
  });
}

// ---- 운영자 화면 ----

export async function courseVideos(db: Db, courseId: string) {
  const [assets, subtitles, slots] = await Promise.all([
    db
      .select()
      .from(schema.videoAssets)
      .where(eq(schema.videoAssets.courseId, courseId))
      .orderBy(desc(schema.videoAssets.createdAt)),
    db
      .select({
        assetId: schema.videoSubtitles.videoAssetId,
        lang: schema.videoSubtitles.lang,
        cues: schema.videoSubtitles.cues,
      })
      .from(schema.videoSubtitles)
      .innerJoin(schema.videoAssets, eq(schema.videoAssets.id, schema.videoSubtitles.videoAssetId))
      .where(eq(schema.videoAssets.courseId, courseId)),
    db
      .select({ key: schema.videoSlots.key, assetId: schema.videoSlots.videoAssetId })
      .from(schema.videoSlots)
      .where(and(eq(schema.videoSlots.courseId, courseId), eq(schema.videoSlots.source, "hosted")))
      .orderBy(asc(schema.videoSlots.key)),
  ]);
  return assets.map((a) => ({
    ...a,
    subtitles: subtitles.filter((s) => s.assetId === a.id),
    linkedKeys: slots.filter((s) => s.assetId === a.id).map((s) => s.key),
  }));
}

export type CourseVideo = Awaited<ReturnType<typeof courseVideos>>[number];

// ---- 재생 ----

export interface Playback {
  token: string;
  expiresAt: string;
  src: string;
  subtitles: { lang: string; label: string; src: string }[];
  durationSec: number | null;
  /** 워터마크: 닉네임 · 회원 번호 일부 */
  mark: string;
}

async function playbackFor(
  db: Db,
  viewer: Viewer,
  assetId: string,
  secret: string,
  now: Date,
): Promise<Playback> {
  const subtitles = await db
    .select({
      lang: schema.videoSubtitles.lang,
      label: schema.videoSubtitles.label,
      path: schema.videoSubtitles.vttPath,
    })
    .from(schema.videoSubtitles)
    .where(eq(schema.videoSubtitles.videoAssetId, assetId));
  const [asset] = await db
    .select({ durationSec: schema.videoAssets.durationSec })
    .from(schema.videoAssets)
    .where(eq(schema.videoAssets.id, assetId));
  const expiresAt = new Date(now.getTime() + MEDIA_TOKEN_TTL_SEC * 1000);
  return {
    token: signMediaToken(secret, { userId: viewer.userId, assetId, expiresAt }),
    expiresAt: expiresAt.toISOString(),
    src: `/media/${mediaPaths(assetId).master}`,
    subtitles: subtitles.map((s) => ({ lang: s.lang, label: s.label, src: `/media/${s.path}` })),
    durationSec: asset?.durationSec ?? null,
    mark: `${viewer.nickname ?? "회원"} · #${memberTag(viewer.userId)}`,
  };
}

/** 학습 화면 재생 (4분마다 다시 불러 토큰을 바꾼다). 수강권 · 운영자 · 그 과정 강사만 */
export async function learnerPlayback(
  db: Db,
  viewer: Viewer,
  input: { courseId: string; videoKey: string },
  secret: string,
  now = new Date(),
): Promise<Playback> {
  const ctx = await learnerContext(db, viewer, input.courseId);
  const [slot] = await db
    .select({
      chapterKey: schema.videoSlots.chapterKey,
      assetId: schema.videoAssets.id,
      status: schema.videoAssets.status,
    })
    .from(schema.videoSlots)
    .innerJoin(schema.videoAssets, eq(schema.videoAssets.id, schema.videoSlots.videoAssetId))
    .where(
      and(
        eq(schema.videoSlots.courseId, ctx.course.id),
        eq(schema.videoSlots.key, input.videoKey),
        eq(schema.videoSlots.source, "hosted"),
      ),
    );
  if (!slot || slot.status !== "ready" || !ctx.chapters.some((c) => c.key === slot.chapterKey))
    throw new CourseError("NOT_FOUND", "영상을 찾을 수 없습니다.", 404);
  return playbackFor(db, viewer, slot.assetId, secret, now);
}

/** 운영자 화면에서 변환 결과 확인 */
export async function adminPlayback(
  db: Db,
  viewer: Viewer,
  assetId: string,
  secret: string,
  now = new Date(),
) {
  const asset = await loadAsset(db, assetId);
  if (asset.status !== "ready") throw new CourseError("NOT_READY", "변환이 끝난 뒤에 볼 수 있습니다.", 409);
  return playbackFor(db, viewer, assetId, secret, now);
}

/** 영상 버킷 안에서 화면이 받아 갈 수 있는 파일: 재생 목록 · 조각 · 자막 */
const MEDIA_PATH =
  /^\/media\/v\/([0-9a-f-]{36})\/(hls\/(?:[0-9a-z]+\/)?[a-z0-9_]+\.(?:m3u8|ts)|subs\/[a-z]{2}\.vtt)$/;

/**
 * 조각 요청 확인 (Caddy forward_auth ➔ /api/v1/media/check). 토큰 서명 · 만료 · 영상 일치만 본다 (DB 를 보지 않아 빠르다).
 * 조각은 암호화돼 있고, 풀 키는 키 서버가 수강권을 다시 확인한 뒤에만 준다.
 */
export function checkMediaRequest(
  secret: string,
  token: string | null,
  uri: string,
  now = new Date(),
): { ok: true; objectPath: string } | { ok: false; status: 401 | 403 | 404 } {
  const path = uri.split("?")[0] ?? "";
  const match = path.match(MEDIA_PATH);
  if (!match) return { ok: false, status: 404 };
  const claims = verifyMediaToken(secret, token, now);
  if (!claims) return { ok: false, status: 401 };
  if (claims.assetId !== match[1]) return { ok: false, status: 403 };
  return { ok: true, objectPath: path.slice("/media/".length) };
}

/** 키 서버: 토큰(같은 사람 · 같은 영상) + 지금 수강권을 다시 확인한 뒤에만 16바이트 키를 준다 */
export async function hlsKeyFor(
  db: Db,
  viewer: Viewer | null,
  assetId: string,
  token: string | null,
  secret: string,
  now = new Date(),
): Promise<Buffer | null> {
  const claims = verifyMediaToken(secret, token, now);
  if (!viewer || !claims || claims.userId !== viewer.userId || claims.assetId !== assetId) return null;
  const [row] = await db
    .select({ course: schema.courses, sealed: schema.hlsKeys.keySealed })
    .from(schema.videoAssets)
    .innerJoin(schema.courses, eq(schema.courses.id, schema.videoAssets.courseId))
    .innerJoin(schema.hlsKeys, eq(schema.hlsKeys.id, schema.videoAssets.keyId))
    .where(eq(schema.videoAssets.id, assetId));
  if (!row) return null;
  if (!canLearn(await viewAccess(db, viewer, row.course, now))) return null;
  return openHlsKey(secret, row.sealed);
}
