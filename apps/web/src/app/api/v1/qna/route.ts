import { z } from "zod";
import { ApiError, json, parseBody, requireApiViewer, route } from "@/server/api";
import { getDb } from "@/server/db";
import { askQuestion, listQuestions } from "@/server/qna";
import { supportDeps } from "@/server/support-deps";
import { askInput } from "@/server/support-input";

const listQuery = z.object({
  courseId: z.uuid(),
  chapterKey: z.string().max(100).nullish(),
  filter: z.enum(["all", "open", "mine"]).default("all"),
  q: z.string().max(100).nullish(),
});

// L-06 질문 목록 (그 강의를 볼 수 있는 사람만)
export const GET = route(async (request) => {
  const viewer = await requireApiViewer(request);
  const parsed = listQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) throw new ApiError(400, "INVALID_INPUT", "입력 오류");
  return json(await listQuestions(getDb(), viewer, parsed.data));
});

// 질문하기 (수강생만). API 키처럼 보이면 409 SECRET_SUSPECTED ➔ 화면이 확인받고 confirmSecret 으로 다시 보낸다
export const POST = route(async (request) => {
  const viewer = await requireApiViewer(request);
  const body = await parseBody(request, askInput);
  return json({ id: await askQuestion(supportDeps(), viewer, body) });
});
