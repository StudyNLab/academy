import { z } from "zod";
import { json, parseBody, requireApiStaff, route, uuidParam } from "@/server/api";
import { getDb } from "@/server/db";
import { closeInquiryByOperator, replyInquiry } from "@/server/inquiries";
import { supportDeps } from "@/server/support-deps";
import { messageInput } from "@/server/support-input";

// AD-13 답변 (답변하고 닫기 포함) · 닫기
export const POST = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  const viewer = await requireApiStaff(request, "operator");
  const id = uuidParam((await params).id);
  const body = await parseBody(
    request,
    z.discriminatedUnion("action", [
      messageInput.extend({ action: z.literal("reply"), close: z.boolean().default(false) }),
      z.object({ action: z.literal("close") }),
    ]),
  );
  if (body.action === "close")
    await closeInquiryByOperator(getDb(), { actorId: viewer.userId, id, headers: request.headers });
  else
    await replyInquiry(supportDeps(), {
      actorId: viewer.userId,
      id,
      body: body.body,
      close: body.close,
      headers: request.headers,
    });
  return json({ ok: true });
});
