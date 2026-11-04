import { z } from "zod";
import { json, parseBody, requireApiStaff, route, uuidParam } from "@/server/api";
import { addPrice } from "@/server/commerce";
import { effectiveFromInput, wonInput } from "@/server/commerce-input";
import { getDb } from "@/server/db";

// AD-07 새 가격 버전 (시행 시각부터, 비우면 지금부터). 이전 주문 · 열린 주문서는 그때 가격 그대로
export const POST = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  const viewer = await requireApiStaff(request, "operator");
  const body = await parseBody(request, z.object({ amount: wonInput, effectiveFrom: effectiveFromInput }));
  const id = await addPrice(getDb(), {
    actorId: viewer.userId,
    productId: uuidParam((await params).id),
    amount: body.amount,
    effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom) : new Date(),
    headers: request.headers,
  });
  return json({ id });
});
