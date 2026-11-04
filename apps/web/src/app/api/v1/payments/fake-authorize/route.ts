import { z } from "zod";
import { json, parseBody, requireApiViewer, route } from "@/server/api";
import { loadOrder } from "@/server/commerce";
import { getDb } from "@/server/db";
import { fakeToss } from "@/server/payments";

// 개발 서버 가짜 결제창 (TOSS_FAKE=1 일 때만, 운영 빌드에서는 404): 사용자가 결제창에서 결제를 마친 것처럼 paymentKey 를 만든다.
// 금액은 결제창에 넘어간 값 그대로 받는다 (화면 흐름 테스트에서 금액 위조도 시험할 수 있게). 승인은 진짜와 같이 /payments/confirm
export const POST = route(async (request) => {
  const fake = fakeToss();
  const viewer = await requireApiViewer(request);
  const body = await parseBody(request, z.object({ orderId: z.uuid(), amount: z.number().int().min(0) }));
  await loadOrder(getDb(), viewer.userId, body.orderId);
  return json({ paymentKey: fake.authorize(body.orderId, body.amount) });
});
