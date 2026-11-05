import { requireApiStaff, route, uuidParam } from "@/server/api";
import { videoPart } from "@/server/course-routes";
import { getDb } from "@/server/db";
import { ownedTarget } from "@/server/instructors";

// I-04 영상 원본 한 조각 (자기 과정의 영상만)
export const PUT = route<{ params: Promise<{ id: string; n: string }> }>(async (request, { params }) => {
  const viewer = await requireApiStaff(request, "instructor");
  const { id: raw, n } = await params;
  const id = uuidParam(raw);
  await ownedTarget(getDb(), viewer, "video", id, { write: true });
  return videoPart(request, id, n);
});
