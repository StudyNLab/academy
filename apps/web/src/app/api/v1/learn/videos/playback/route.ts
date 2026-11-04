import { z } from "zod";
import { json, parseBody, requireApiViewer, route } from "@/server/api";
import { getDb } from "@/server/db";
import { getEnv } from "@/server/env";
import { learnerPlayback } from "@/server/videos";

// 학습 화면: 자체 서버 영상 재생 정보 + 5분짜리 재생 토큰 (수강권 확인). 화면이 4분마다 다시 불러 토큰을 바꾼다
export const POST = route(async (request) => {
  const viewer = await requireApiViewer(request);
  const body = await parseBody(request, z.object({ courseId: z.uuid(), videoKey: z.string().max(64) }));
  return json(await learnerPlayback(getDb(), viewer, body, getEnv().BETTER_AUTH_SECRET));
});
