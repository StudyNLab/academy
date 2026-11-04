import { z } from "zod";
import { json, parseBody, requireApiViewer, route, uuidParam } from "@/server/api";
import { getDb } from "@/server/db";
import { addMemberMessage, closeInquiryByMember } from "@/server/inquiries";
import { messageInput } from "@/server/support-input";

// 내 문의에 이어서 쓰기 · 닫기
export const POST = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  const viewer = await requireApiViewer(request);
  const id = uuidParam((await params).id);
  const body = await parseBody(
    request,
    z.discriminatedUnion("action", [
      messageInput.extend({ action: z.literal("message") }),
      z.object({ action: z.literal("close") }),
    ]),
  );
  if (body.action === "close") await closeInquiryByMember(getDb(), viewer, id);
  else await addMemberMessage(getDb(), viewer, id, body.body);
  return json({ ok: true });
});
