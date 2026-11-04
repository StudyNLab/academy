import { ApiError, json, requireApiViewer, route, uuidParam } from "@/server/api";
import { getDb } from "@/server/db";
import type { QuestionAction } from "@/server/qna";
import { changeQuestion } from "@/server/qna";

const ACTIONS: QuestionAction[] = ["resolve", "reopen", "pin", "unpin", "delete"];

// 해결됨 · 다시 열기 (질문자) / 고정 · 고정 풀기 (강사 · 운영자) / 지우기 (작성자)
export const POST = route<{ params: Promise<{ id: string; action: string }> }>(
  async (request, { params }) => {
    const viewer = await requireApiViewer(request);
    const { id, action } = await params;
    if (!ACTIONS.includes(action as QuestionAction))
      throw new ApiError(404, "NOT_FOUND", "찾을 수 없습니다.");
    await changeQuestion(getDb(), viewer, uuidParam(id), action as QuestionAction);
    return json({ ok: true });
  },
);
