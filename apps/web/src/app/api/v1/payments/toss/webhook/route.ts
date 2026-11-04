import { z } from "zod";
import { commerceDeps, paymentsEnabled } from "@/server/payments";
import { handleTossWebhook } from "@/server/refunds";

// 토스 웹훅 (PAYMENT_STATUS_CHANGED). 토스 서버가 보내므로 Origin 확인(route)을 거치지 않는다.
// 내용은 믿지 않고 paymentKey 로 토스에 다시 조회한 결과로만 맞춘다. 토스는 200 이 아니면 다시 보낸다.
const body = z.object({
  eventType: z.string().max(64),
  data: z.looseObject({ paymentKey: z.string().max(200).nullish() }).nullish(),
});

export async function POST(request: Request): Promise<Response> {
  if (!paymentsEnabled()) return new Response(null, { status: 503 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new Response(null, { status: 400 });
  const result = await handleTossWebhook(commerceDeps(), {
    eventType: parsed.data.eventType,
    paymentKey: parsed.data.data?.paymentKey ?? null,
  });
  return Response.json({ result }, { status: result.startsWith("error") ? 500 : 200 });
}
