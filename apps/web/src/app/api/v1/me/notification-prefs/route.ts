import { z } from "zod";
import { json, parseBody, requireApiViewer, route } from "@/server/api";
import { getDb } from "@/server/db";
import { setNotificationPrefs } from "@/server/notifications";

// M-01 메일 알림 설정 (Q&A 답변 · 만료 알림). 마케팅 메일은 /me/marketing
export const POST = route(async (request) => {
  const viewer = await requireApiViewer(request);
  const body = await parseBody(
    request,
    z.object({ qnaAnswerEmail: z.boolean().optional(), expiryEmail: z.boolean().optional() }),
  );
  return json(await setNotificationPrefs(getDb(), viewer.userId, body));
});
