import { z } from "zod";
import { ApiError, json, parseBody, requireApiViewer, route } from "@/server/api";
import { getDb } from "@/server/db";
import { REFUND_REASONS, requestRefund } from "@/server/refunds";

// M-04 환불 요청. 금액은 서버가 규정대로 다시 계산한다
export const POST = route(async (request) => {
  const viewer = await requireApiViewer(request);
  const body = await parseBody(
    request,
    z.object({
      itemId: z.uuid(),
      reason: z.enum(REFUND_REASONS, { error: "사유를 골라 주세요." }),
      detail: z.string().trim().max(500).nullish(),
    }),
  );
  if (body.reason === "기타" && !body.detail) throw new ApiError(400, "INVALID_INPUT", "사유를 적어 주세요.");
  const id = await requestRefund({ db: getDb() }, viewer, {
    itemId: body.itemId,
    reason: body.reason,
    detail: body.detail ?? null,
  });
  return json({ id });
});
