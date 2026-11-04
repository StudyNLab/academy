import { z } from "zod";
import { json, parseBody, requireApiViewer, route } from "@/server/api";
import { getDb } from "@/server/db";
import { learnerContext, setSelfCheck } from "@/server/learning";

// 실습 스스로 확인 (체크 즉시 저장)
export const POST = route(async (request) => {
  const viewer = await requireApiViewer(request);
  const body = await parseBody(
    request,
    z.object({
      courseId: z.uuid(),
      chapterKey: z.string().max(64),
      sectionId: z.string().max(64),
      itemId: z.string().max(32),
      checked: z.boolean(),
    }),
  );
  const db = getDb();
  const ctx = await learnerContext(db, viewer, body.courseId);
  return json(await setSelfCheck(db, viewer.userId, ctx, body));
});
