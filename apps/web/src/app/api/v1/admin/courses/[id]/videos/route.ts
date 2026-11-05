import { requireApiStaff, route, uuidParam } from "@/server/api";
import { videoStart } from "@/server/course-routes";

// AD-05: 자체 서버 영상 올리기 시작 ➔ 조각마다 PUT /admin/videos/{id}/parts/{n} ➔ POST /admin/videos/{id}/complete
export const POST = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  const viewer = await requireApiStaff(request, "operator");
  const id = uuidParam((await params).id);
  return videoStart(request, viewer, id);
});
