import { z } from "zod";
import { json, parseBody, requireApiStaff, route } from "@/server/api";
import { getDb } from "@/server/db";
import { dismissReports, moderatePost } from "@/server/qna";
import { moderateInput } from "@/server/support-input";

// AD-17 숨기기 · 다시 보이기 (사유) / 신고를 문제없음으로 정리
export const POST = route(async (request) => {
  const viewer = await requireApiStaff(request, "operator");
  const body = await parseBody(
    request,
    z.discriminatedUnion("action", [
      moderateInput.extend({ action: z.literal("moderate") }),
      z.object({
        action: z.literal("dismiss"),
        targetType: z.enum(["question", "answer"]),
        targetId: z.uuid(),
      }),
    ]),
  );
  const target = { targetType: body.targetType, targetId: body.targetId };
  if (body.action === "dismiss") {
    const dismissed = await dismissReports(getDb(), {
      actorId: viewer.userId,
      ...target,
      headers: request.headers,
    });
    return json({ dismissed });
  }
  await moderatePost(getDb(), {
    actorId: viewer.userId,
    ...target,
    hide: body.hide,
    reason: body.reason,
    headers: request.headers,
  });
  return json({ ok: true });
});
