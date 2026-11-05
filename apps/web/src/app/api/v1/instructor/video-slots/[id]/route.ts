import { requireApiStaff, route, uuidParam } from "@/server/api";
import { slotLink } from "@/server/course-routes";
import { getDb } from "@/server/db";
import { ownedTarget } from "@/server/instructors";

// I-04 영상 자리에 유튜브 주소 · 자체 서버 영상 연결 (자기 과정의 자리만, 영상도 같은 과정 것만)
export const POST = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  const viewer = await requireApiStaff(request, "instructor");
  const id = uuidParam((await params).id);
  await ownedTarget(getDb(), viewer, "slot", id, { write: true });
  return slotLink(request, viewer, id);
});
