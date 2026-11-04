import { ApiError, json, requireApiStaff, route, uuidParam } from "@/server/api";
import { videoDeps } from "@/server/course-deps";
import { uploadVideoPart, VIDEO_PART_BYTES } from "@/server/videos";

// 영상 원본 한 조각 (16MB, 본문 그대로). 같은 조각을 다시 보내면 덮어쓴다 (끊겼을 때 다시 보내기)
export const PUT = route<{ params: Promise<{ id: string; n: string }> }>(async (request, { params }) => {
  await requireApiStaff(request, "operator");
  const { id, n } = await params;
  if (Number(request.headers.get("content-length") ?? 0) > VIDEO_PART_BYTES)
    throw new ApiError(413, "TOO_LARGE", "조각이 너무 큽니다.");
  const body = Buffer.from(await request.arrayBuffer());
  await uploadVideoPart(videoDeps(), uuidParam(id), Number(n), body);
  return json({ ok: true });
});
