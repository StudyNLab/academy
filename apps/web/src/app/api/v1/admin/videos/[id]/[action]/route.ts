import { ApiError, json, requireApiStaff, route, uuidParam } from "@/server/api";
import { videoDeps } from "@/server/course-deps";
import { getEnv } from "@/server/env";
import {
  addSubtitle,
  adminPlayback,
  completeVideoUpload,
  MAX_SUBTITLE_BYTES,
  retranscodeVideo,
} from "@/server/videos";

// AD-05 영상 작업: complete(다 올림 ➔ 변환 대기열) · retranscode(다시 변환) · subtitles(srt, multipart file) ·
// playback(운영자 화면에서 변환 결과 재생)
export const POST = route<{ params: Promise<{ id: string; action: string }> }>(
  async (request, { params }) => {
    const viewer = await requireApiStaff(request, "operator");
    const { id, action } = await params;
    const assetId = uuidParam(id);
    const actor = { actorId: viewer.userId, headers: request.headers };
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
  },
);
