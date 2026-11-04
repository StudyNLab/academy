import { z } from "zod";
import { json, parseBody, requireApiViewer, route } from "@/server/api";
import { confirmPayment } from "@/server/commerce";
import { commerceDeps } from "@/server/payments";

// 결제창에서 돌아온 값으로 서버가 토스 승인을 받는다 (금액 대조 · 중복 승인 방지는 confirmPayment)
export const POST = route(async (request) => {
  const viewer = await requireApiViewer(request);
  const body = await parseBody(
    request,
    z.object({
      paymentKey: z.string().min(1).max(200),
      orderId: z.uuid(),
      amount: z.number().int().min(0).max(100_000_000),
    }),
  );
  const result = await confirmPayment(commerceDeps(), viewer, body);
  return json({ ...result, accessUntil: result.accessUntil?.toISOString() ?? null });
});
