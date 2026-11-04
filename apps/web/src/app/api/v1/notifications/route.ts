import { json, requireApiViewer, route } from "@/server/api";
import { getDb } from "@/server/db";
import { markAllRead } from "@/server/notifications";

// 알림 모두 읽음
export const POST = route(async (request) => {
  const viewer = await requireApiViewer(request);
  await markAllRead(getDb(), viewer.userId);
  return json({ ok: true });
});
