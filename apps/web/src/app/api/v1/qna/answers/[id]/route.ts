import { json, requireApiViewer, route, uuidParam } from "@/server/api";
import { getDb } from "@/server/db";
import { deleteAnswer } from "@/server/qna";

// 내 답변 지우기 (내용은 비운다)
export const DELETE = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  const viewer = await requireApiViewer(request);
  await deleteAnswer(getDb(), viewer, uuidParam((await params).id));
  return json({ ok: true });
});
