import "server-only";
// 과정 관리 API 의 본문 (운영자 /api/v1/admin/... · 강사 /api/v1/instructor/... 가 같이 쓴다).
// 권한은 부르는 쪽이 먼저 확인한다: 운영자는 requireApiStaff("operator"),
// 강사는 requireApiStaff("instructor") + ownedTarget (자기 과정의 것인지).
import { Readable } from "node:stream";
import { z } from "zod";
import { eq, schema } from "@aionit/db";
import { ApiError, json, parseBody } from "./api";
import { courseDeps, videoDeps } from "./course-deps";
import {
  addAttachment,
  linkYoutube,
  MAX_ATTACHMENT_BYTES,
  MAX_PACKAGE_BYTES,
  removeAttachment,
  setPreviewRule,
  uploadPackage,
} from "./courses";
import { getDb } from "./db";
import { getEnv } from "./env";
import { getStore } from "./storage";
import {
  addSubtitle,
  adminPlayback,
  completeVideoUpload,
  linkHosted,
  MAX_SUBTITLE_BYTES,
  removeVideo,
  retranscodeVideo,
  startVideoUpload,
  uploadedParts,
  uploadVideoPart,
  VIDEO_PART_BYTES,
} from "./videos";
import type { Viewer } from "./viewer";

const actorOf = (viewer: Viewer, request: Request) => ({ actorId: viewer.userId, headers: request.headers });

/** 교재 패키지 올리기 (multipart, 필드 이름 package). 검사 · 정리는 worker 가 이어서 한다 */
export async function packageUpload(request: Request, viewer: Viewer, courseId: string) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_PACKAGE_BYTES + 1024 * 1024) {
    throw new ApiError(413, "TOO_LARGE", "패키지는 200MB 까지 올릴 수 있습니다.");
  }
  const form = await request.formData().catch(() => null);
  const file = form?.get("package");
  if (!(file instanceof File)) throw new ApiError(400, "NO_FILE", "zip 파일을 골라 주세요.");
  const version = await uploadPackage(courseDeps(), {
    courseId,
    zip: Buffer.from(await file.arrayBuffer()),
    fileName: file.name,
    ...actorOf(viewer, request),
  });
  return json({ id: version.id, version: version.version }, 202);
}

/** 자체 서버 영상 올리기 시작 ➔ 조각마다 PUT .../videos/{id}/parts/{n} ➔ POST .../videos/{id}/complete */
export async function videoStart(request: Request, viewer: Viewer, courseId: string) {
  const body = await parseBody(
    request,
    z.object({
      title: z.string().trim().min(2, "제목을 2자 이상 적어 주세요.").max(100, "제목은 100자까지입니다."),
      fileName: z.string().min(1).max(300),
      size: z.number().int().positive(),
    }),
  );
  const result = await startVideoUpload(videoDeps(), { courseId, ...body, ...actorOf(viewer, request) });
  return json(result, 201);
}

/** 영상 작업: complete · retranscode · subtitles(srt, multipart file) · playback(관리 화면에서 변환 결과 재생) */
export async function videoAction(request: Request, viewer: Viewer, assetId: string, action: string) {
  const actor = actorOf(viewer, request);
  const deps = videoDeps();
  switch (action) {
    case "complete":
      await completeVideoUpload(deps, assetId, actor);
      return json({ ok: true });
    case "retranscode":
      await retranscodeVideo(deps, assetId, actor);
      return json({ ok: true });
    case "subtitles": {
      if (Number(request.headers.get("content-length") ?? 0) > MAX_SUBTITLE_BYTES + 64 * 1024)
        throw new ApiError(413, "TOO_LARGE", "자막은 2MB 까지입니다.");
      const file = (await request.formData().catch(() => null))?.get("file");
      if (!(file instanceof File)) throw new ApiError(400, "NO_FILE", "srt 파일을 골라 주세요.");
      if (!/\.srt$/i.test(file.name))
        throw new ApiError(400, "BAD_TYPE", "srt 자막 파일만 올릴 수 있습니다.");
      return json(
        await addSubtitle(deps, assetId, {
          srt: Buffer.from(await file.arrayBuffer()),
          fileName: file.name,
          ...actor,
        }),
      );
    }
    case "playback":
      return json(await adminPlayback(deps.db, viewer, assetId, getEnv().BETTER_AUTH_SECRET));
    default:
      throw new ApiError(404, "NOT_FOUND", "찾을 수 없습니다.");
  }
}

/** 영상 원본 한 조각 (16MB, 본문 그대로). 같은 조각을 다시 보내면 덮어쓴다 (끊겼을 때 다시 보내기) */
export async function videoPart(request: Request, assetId: string, n: string) {
  if (Number(request.headers.get("content-length") ?? 0) > VIDEO_PART_BYTES)
    throw new ApiError(413, "TOO_LARGE", "조각이 너무 큽니다.");
  const body = Buffer.from(await request.arrayBuffer());
  await uploadVideoPart(videoDeps(), assetId, Number(n), body);
  return json({ ok: true });
}

/** 올리는 중인 영상: 이미 올라간 조각 (이어 올리기) */
export async function videoParts(assetId: string) {
  return json(await uploadedParts(videoDeps(), assetId));
}

export async function videoRemove(request: Request, viewer: Viewer, assetId: string) {
  await removeVideo(videoDeps(), assetId, actorOf(viewer, request));
  return json({ ok: true });
}

/** 영상 자리에 유튜브 주소(url) 또는 자체 서버 영상(assetId) 연결 · 끊기 (null) */
export async function slotLink(request: Request, viewer: Viewer, slotId: string) {
  const body = await parseBody(
    request,
    z.union([
      z.object({ url: z.string().trim().max(300).nullable() }),
      z.object({ assetId: z.uuid().nullable() }),
    ]),
  );
  const actor = actorOf(viewer, request);
  if ("assetId" in body) await linkHosted(getDb(), slotId, { assetId: body.assetId, ...actor });
  else await linkYoutube(getDb(), slotId, { url: body.url || null, ...actor });
  return json({ ok: true });
}

/** 무료 미리보기 지정 (챕터 전체 · 일부 Section · 끄기) */
export async function previewRule(request: Request, viewer: Viewer, courseId: string) {
  const body = await parseBody(
    request,
    z.object({
      chapterKey: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,40}$/),
      scope: z.enum(["whole", "sections", "none"]),
      sectionIds: z
        .array(z.string().regex(/^sec-\d+$/))
        .max(100)
        .optional(),
    }),
  );
  await setPreviewRule(getDb(), courseId, { ...body, ...actorOf(viewer, request) });
  return json({ ok: true });
}

/** 첨부 자료 등록 (챕터별 실습 파일 zip). multipart: file, title, chapterKey(비우면 과정 전체) */
export async function attachmentAdd(request: Request, viewer: Viewer, courseId: string) {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_ATTACHMENT_BYTES + 1024 * 1024) {
    throw new ApiError(413, "TOO_LARGE", "첨부 파일은 100MB 까지입니다.");
  }
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const title = String(form?.get("title") ?? "").trim();
  const chapterKey = String(form?.get("chapterKey") ?? "").trim();
  if (!(file instanceof File)) throw new ApiError(400, "NO_FILE", "zip 파일을 골라 주세요.");
  if (title.length < 2 || title.length > 100)
    throw new ApiError(400, "BAD_TITLE", "제목을 2 ~ 100자로 적어 주세요.");
  if (chapterKey && !/^[a-z0-9][a-z0-9_-]{0,40}$/.test(chapterKey)) {
    throw new ApiError(400, "BAD_CHAPTER", "챕터를 확인해 주세요.");
  }
  const row = await addAttachment(courseDeps(), {
    courseId,
    chapterKey: chapterKey || null,
    title,
    file: Buffer.from(await file.arrayBuffer()),
    fileName: file.name,
    ...actorOf(viewer, request),
  });
  return json({ id: row.id }, 201);
}

/** 관리 화면에서 첨부 자료 받기 (받은 기록 없이). 수강생은 /api/v1/learn/attachments/[id] */
export async function attachmentDownload(attachmentId: string) {
  const [row] = await getDb()
    .select({
      objectKey: schema.files.objectKey,
      name: schema.files.originalName,
      title: schema.attachments.title,
    })
    .from(schema.attachments)
    .innerJoin(schema.files, eq(schema.files.id, schema.attachments.fileId))
    .where(eq(schema.attachments.id, attachmentId));
  const object = row ? await getStore().get(row.objectKey) : null;
  if (!row || !object) throw new ApiError(404, "NOT_FOUND", "파일을 찾을 수 없습니다.");
  const name = encodeURIComponent(row.name ?? `${row.title}.zip`);
  return new Response(Readable.toWeb(object.body) as ReadableStream, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename*=UTF-8''${name}`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export async function attachmentRemove(request: Request, viewer: Viewer, attachmentId: string) {
  await removeAttachment(getDb(), attachmentId, actorOf(viewer, request));
  return json({ ok: true });
}
