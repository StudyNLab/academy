import { requireApiStaff, route, uuidParam } from "@/server/api";
import { packageUpload } from "@/server/course-routes";
import { getDb } from "@/server/db";
import { ownedTarget } from "@/server/instructors";

// I-03 교재 패키지 올리기 (자기 과정만). 검사를 통과하면 강사가 검수를 요청한다 (I-05)
export const POST = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  const viewer = await requireApiStaff(request, "instructor");
  const id = uuidParam((await params).id);
  await ownedTarget(getDb(), viewer, "course", id, { write: true });
  return packageUpload(request, viewer, id);
});
