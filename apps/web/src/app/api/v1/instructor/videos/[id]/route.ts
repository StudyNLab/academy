import { requireApiStaff, route, uuidParam } from "@/server/api";
import { videoParts, videoRemove } from "@/server/course-routes";
import { getDb } from "@/server/db";
import { ownedTarget } from "@/server/instructors";

// I-04 올리는 중인 영상의 조각 (이어 올리기) · 영상 지우기 (자기 과정의 영상만)
export const GET = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  const viewer = await requireApiStaff(request, "instructor");
  const id = uuidParam((await params).id);
  await ownedTarget(getDb(), viewer, "video", id);
  return videoParts(id);
});

export const DELETE = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  const viewer = await requireApiStaff(request, "instructor");
  const id = uuidParam((await params).id);
  await ownedTarget(getDb(), viewer, "video", id, { write: true });
  return videoRemove(request, viewer, id);
});
