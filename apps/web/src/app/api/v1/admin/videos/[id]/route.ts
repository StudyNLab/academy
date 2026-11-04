import { json, requireApiStaff, route, uuidParam } from "@/server/api";
import { videoDeps } from "@/server/course-deps";
import { removeVideo, uploadedParts } from "@/server/videos";

// 올리는 중인 영상: 이미 올라간 조각 (이어 올리기) · 영상 지우기
export const GET = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  await requireApiStaff(request, "operator");
  return json(await uploadedParts(videoDeps(), uuidParam((await params).id)));
});

export const DELETE = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  const viewer = await requireApiStaff(request, "operator");
  await removeVideo(videoDeps(), uuidParam((await params).id), {
    actorId: viewer.userId,
    headers: request.headers,
  });
  return json({ ok: true });
});
