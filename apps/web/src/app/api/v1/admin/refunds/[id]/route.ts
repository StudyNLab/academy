import { z } from "zod";
import { json, parseBody, requireApiStaff, route, uuidParam } from "@/server/api";
import { commerceDeps } from "@/server/payments";
import { approveRefund, rejectRefund } from "@/server/refunds";

// AD-10 환불 승인(토스 취소) · 거절(사유)
export const POST = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  const viewer = await requireApiStaff(request, "operator");
  const refundId = uuidParam((await params).id);
  const body = await parseBody(
    request,
    z.discriminatedUnion("action", [
      z.object({
        action: z.literal("approve"),
        amount: z.number().int().min(1).nullish(),
        note: z.string().trim().max(500).nullish(),
      }),
      z.object({
        action: z.literal("reject"),
        note: z.string().trim().min(2, { error: "거절 사유를 적어 주세요." }).max(500),
      }),
    ]),
  );
  const deps = commerceDeps();
  if (body.action === "approve")
    await approveRefund(deps, {
      actorId: viewer.userId,
      refundId,
      amount: body.amount ?? null,
      note: body.note ?? null,
      headers: request.headers,
    });
  else
    await rejectRefund(deps, { actorId: viewer.userId, refundId, note: body.note, headers: request.headers });
  return json({ ok: true });
});
