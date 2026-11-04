import { z } from "zod";
import { ApiError, json, parseBody, requireApiViewer, route } from "@/server/api";
import { createOrder } from "@/server/commerce";
import { getDb } from "@/server/db";
import { paymentsEnabled } from "@/server/payments";

// 구매하기 ➔ 주문서(C-01)용 주문을 만든다 (가격 · 할인 스냅샷). 이미 수강 중이면 만들지 않는다
export const POST = route(async (request) => {
  const viewer = await requireApiViewer(request);
  if (!paymentsEnabled()) throw new ApiError(503, "PAYMENTS_DISABLED", "결제를 준비하고 있습니다.");
  const body = await parseBody(request, z.object({ productId: z.uuid({ error: "상품을 골라 주세요." }) }));
  return json(await createOrder(getDb(), viewer, body.productId));
});
