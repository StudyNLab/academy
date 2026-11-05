import { requireApiStaff, route, uuidParam } from "@/server/api";
import { videoPart } from "@/server/course-routes";

// 영상 원본 한 조각 (16MB, 본문 그대로). 같은 조각을 다시 보내면 덮어쓴다 (끊겼을 때 다시 보내기)
export const PUT = route<{ params: Promise<{ id: string; n: string }> }>(async (request, { params }) => {
  await requireApiStaff(request, "operator");
  const { id, n } = await params;
  return videoPart(request, uuidParam(id), n);
});
