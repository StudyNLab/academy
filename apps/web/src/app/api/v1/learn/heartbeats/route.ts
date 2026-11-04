import { z } from "zod";
import { json, parseBody, requireApiViewer, route } from "@/server/api";
import { getDb } from "@/server/db";
import { learnerContext, recordHeartbeats } from "@/server/learning";

const range = z.tuple([z.number().min(0), z.number().min(0)]);
const beat = z.discriminatedUnion("kind", [
  z.object({
    chapterKey: z.string().max(64),
    kind: z.literal("text"),
    at: z.iso.datetime(),
    activeSec: z.number().min(0).max(60),
  }),
  z.object({
    chapterKey: z.string().max(64),
    kind: z.literal("video"),
    at: z.iso.datetime(),
    videoKey: z.string().max(64),
    ranges: z.array(range).max(20),
    positionSec: z.number().min(0),
    durationSec: z.number().min(0),
  }),
]);

// 학습 신호 (30초마다, 연결이 끊겼던 것은 모아서). 유효 학습 시간 · 교재 머문 시간 · 영상 시청의 근거
export const POST = route(async (request) => {
  const viewer = await requireApiViewer(request);
  const body = await parseBody(
    request,
    z.object({ courseId: z.uuid(), beats: z.array(beat).min(1).max(120) }),
  );
  const db = getDb();
  const ctx = await learnerContext(db, viewer, body.courseId);
  return json(await recordHeartbeats(db, viewer.userId, ctx, body.beats));
});
