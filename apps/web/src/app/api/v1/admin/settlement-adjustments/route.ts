import { z } from "zod";
import { json, parseBody, requireApiStaff, route } from "@/server/api";
import { getDb } from "@/server/db";
import { adjust } from "@/server/settlements";

// AD-16 운영자 조정 (수수료 정정 등). 다음에 계산하는 달에 한 번 들어간다
export const POST = route(async (request) => {
  const viewer = await requireApiStaff(request, "operator");
  const body = await parseBody(
    request,
    z.object({
      instructorId: z.uuid("강사를 골라 주세요."),
      amount: z.number().int("조정 금액은 원 단위 정수로 적어 주세요."),
      reason: z.string().trim().min(2, "조정 사유를 적어 주세요.").max(500),
    }),
  );
  const row = await adjust(getDb(), { ...body, actorId: viewer.userId, headers: request.headers });
  return json({ ok: true, id: row.id });
});
