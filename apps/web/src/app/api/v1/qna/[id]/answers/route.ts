import { json, parseBody, requireApiViewer, route, uuidParam } from "@/server/api";
import { answerQuestion } from "@/server/qna";
import { supportDeps } from "@/server/support-deps";
import { answerInput } from "@/server/support-input";

// 답변 쓰기 (수강생끼리 · 강사 · 운영자)
export const POST = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  const viewer = await requireApiViewer(request);
  const body = await parseBody(request, answerInput);
  return json({ id: await answerQuestion(supportDeps(), viewer, uuidParam((await params).id), body) });
});
