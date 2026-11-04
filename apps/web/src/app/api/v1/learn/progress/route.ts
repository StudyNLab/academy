import { z } from "zod";
import { json, parseBody, requireApiViewer, route } from "@/server/api";
import { getDb } from "@/server/db";
import { learnerContext, saveReadPosition } from "@/server/learning";

// 읽은 위치 저장 (스크롤이 멈추고 5초 뒤 · 화면을 떠날 때)
export const POST = route(async (request) => {
  const viewer = await requireApiViewer(request);
  const body = await parseBody(
    request,
    z.object({
      courseId: z.uuid(),
      chapterKey: z.string().max(64),
      sectionId: z.string().max(64).nullable(),
      readRatio: z.number().min(0).max(1),
      reachedEnd: z.boolean(),
    }),
  );
  const db = getDb();
  const ctx = await learnerContext(db, viewer, body.courseId);
  return json(await saveReadPosition(db, viewer.userId, ctx, body));
});
