import { requireApiStaff, route, uuidParam } from "@/server/api";
import { previewRule } from "@/server/course-routes";
import { getDb } from "@/server/db";
import { ownedTarget } from "@/server/instructors";

// I-05 무료 미리보기 범위 (자기 과정만)
export const POST = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  const viewer = await requireApiStaff(request, "instructor");
  const id = uuidParam((await params).id);
  await ownedTarget(getDb(), viewer, "course", id, { write: true });
  return previewRule(request, viewer, id);
});
