import { requireApiStaff, route, uuidParam } from "@/server/api";
import { attachmentDownload, attachmentRemove } from "@/server/course-routes";
import { getDb } from "@/server/db";
import { ownedTarget } from "@/server/instructors";

// 첨부 자료 받기 · 지우기 (자기 과정의 것만)
export const GET = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  const viewer = await requireApiStaff(request, "instructor");
  const id = uuidParam((await params).id);
  await ownedTarget(getDb(), viewer, "attachment", id);
  return attachmentDownload(id);
});

export const DELETE = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  const viewer = await requireApiStaff(request, "instructor");
  const id = uuidParam((await params).id);
  await ownedTarget(getDb(), viewer, "attachment", id, { write: true });
  return attachmentRemove(request, viewer, id);
});
