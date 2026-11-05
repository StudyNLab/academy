import { requireApiStaff, route, uuidParam } from "@/server/api";
import { attachmentAdd } from "@/server/course-routes";

// 첨부 자료 등록 (챕터별 실습 파일 zip). multipart: file, title, chapterKey(비우면 과정 전체)
export const POST = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  const viewer = await requireApiStaff(request, "operator");
  const id = uuidParam((await params).id);
  return attachmentAdd(request, viewer, id);
});
