import { requireApiStaff, route, uuidParam } from "@/server/api";
import { packageUpload } from "@/server/course-routes";

// AD-03 교재 패키지 올리기 (multipart, 필드 이름 package). 검사 · 정리는 worker 가 이어서 한다
export const POST = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  const viewer = await requireApiStaff(request, "operator");
  const id = uuidParam((await params).id);
  return packageUpload(request, viewer, id);
});
