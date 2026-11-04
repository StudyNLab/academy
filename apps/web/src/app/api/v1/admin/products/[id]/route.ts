import { z } from "zod";
import { json, parseBody, requireApiStaff, route, uuidParam } from "@/server/api";
import { updateProduct } from "@/server/commerce";
import { accessDaysInput, productName } from "@/server/commerce-input";
import { getDb } from "@/server/db";

// AD-07 상품 이름 · 수강 기간 · 판매 상태. 이미 한 주문은 그때 값 그대로다 (스냅샷)
export const POST = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  const viewer = await requireApiStaff(request, "operator");
  const body = await parseBody(
    request,
    z.object({
      name: productName.optional(),
      accessDays: accessDaysInput.optional(),
      status: z.enum(["on_sale", "stopped"]).optional(),
    }),
  );
  await updateProduct(getDb(), {
    actorId: viewer.userId,
    productId: uuidParam((await params).id),
    ...body,
    headers: request.headers,
  });
  return json({ ok: true });
});
