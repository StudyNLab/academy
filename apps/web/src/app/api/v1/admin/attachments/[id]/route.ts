import { requireApiStaff, route, uuidParam } from "@/server/api";
import { attachmentDownload, attachmentRemove } from "@/server/course-routes";

// 운영자: 첨부 자료 받기 (기록 없이) · 지우기. 수강생은 /api/v1/learn/attachments/[id]
export const GET = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  await requireApiStaff(request, "operator");
  return attachmentDownload(uuidParam((await params).id));
});

export const DELETE = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  const viewer = await requireApiStaff(request, "operator");
  return attachmentRemove(request, viewer, uuidParam((await params).id));
});
