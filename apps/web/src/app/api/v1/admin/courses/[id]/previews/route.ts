import { requireApiStaff, route, uuidParam } from "@/server/api";
import { previewRule } from "@/server/course-routes";

// AD-06 무료 미리보기 지정 (챕터 전체 · 일부 Section · 끄기)
export const POST = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  const viewer = await requireApiStaff(request, "operator");
  const id = uuidParam((await params).id);
  return previewRule(request, viewer, id);
});
