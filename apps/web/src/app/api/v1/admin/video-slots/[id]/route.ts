import { requireApiStaff, route, uuidParam } from "@/server/api";
import { slotLink } from "@/server/course-routes";

// AD-05: 영상 자리에 유튜브 주소(url) 또는 자체 서버 영상(assetId) 연결 · 끊기 (null)
export const POST = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  const viewer = await requireApiStaff(request, "operator");
  const id = uuidParam((await params).id);
  return slotLink(request, viewer, id);
});
