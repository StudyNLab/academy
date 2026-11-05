import { requireApiStaff, route, uuidParam } from "@/server/api";
import { videoStart } from "@/server/course-routes";
import { getDb } from "@/server/db";
import { ownedTarget } from "@/server/instructors";

// I-04 자체 서버 영상 올리기 시작 (자기 과정만)
export const POST = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  const viewer = await requireApiStaff(request, "instructor");
  const id = uuidParam((await params).id);
  await ownedTarget(getDb(), viewer, "course", id, { write: true });
  return videoStart(request, viewer, id);
});
