import { json, requireApiViewer, route, uuidParam } from "@/server/api";
import { getDb } from "@/server/db";
import { questionDetail } from "@/server/qna";

// 질문 하나와 답변 (비밀글은 질문자 · 그 과정 강사 · 운영자만)
export const GET = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  const viewer = await requireApiViewer(request);
  return json(await questionDetail(getDb(), viewer, uuidParam((await params).id)));
});
