import { requireApiStaff, route, uuidParam } from "@/server/api";
import { videoParts, videoRemove } from "@/server/course-routes";

// 올리는 중인 영상: 이미 올라간 조각 (이어 올리기) · 영상 지우기
export const GET = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  await requireApiStaff(request, "operator");
  return videoParts(uuidParam((await params).id));
});

export const DELETE = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  const viewer = await requireApiStaff(request, "operator");
  return videoRemove(request, viewer, uuidParam((await params).id));
});
