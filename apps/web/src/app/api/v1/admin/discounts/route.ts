import { z } from "zod";
import { json, parseBody, requireApiStaff, route } from "@/server/api";
import { addDiscountPolicy } from "@/server/commerce";
import { effectiveFromInput } from "@/server/commerce-input";
import { getDb } from "@/server/db";

// AD-07 구독자 할인율 (프리미엄 강의) 새 버전
export const POST = route(async (request) => {
  const viewer = await requireApiStaff(request, "operator");
  const body = await parseBody(
    request,
    z.object({
      ratePercent: z.number({ error: "할인율을 적어 주세요." }).int().min(0).max(100),
      effectiveFrom: effectiveFromInput,
    }),
  );
  await addDiscountPolicy(getDb(), {
    actorId: viewer.userId,
    ratePercent: body.ratePercent,
    effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom) : new Date(),
    headers: request.headers,
  });
  return json({ ok: true });
});
