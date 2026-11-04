import { z } from "zod";
import { json, parseBody, requireApiStaff, route } from "@/server/api";
import { createProduct } from "@/server/commerce";
import { accessDaysInput, productName, wonInput } from "@/server/commerce-input";
import { getDb } from "@/server/db";

// AD-07 상품 만들기 (단건 강의 · 연장권) + 첫 가격 (지금부터)
export const POST = route(async (request) => {
  const viewer = await requireApiStaff(request, "operator");
  const body = await parseBody(
    request,
    z.object({
      type: z.enum(["course", "extension"]),
      courseId: z.uuid({ error: "과정을 골라 주세요." }),
      name: productName,
      accessDays: accessDaysInput,
      amount: wonInput,
    }),
  );
  const id = await createProduct(getDb(), { actorId: viewer.userId, ...body, headers: request.headers });
  return json({ id });
});
