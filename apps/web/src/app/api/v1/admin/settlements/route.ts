import { z } from "zod";
import { json, parseBody, requireApiStaff, route } from "@/server/api";
import { getDb } from "@/server/db";
import { calculate } from "@/server/settlements";

// AD-16 월 정산 계산 (확정 전이면 다시 계산)
export const POST = route(async (request) => {
  const viewer = await requireApiStaff(request, "operator");
  const body = await parseBody(
    request,
    z.object({ month: z.string().regex(/^\d{4}-\d{2}$/, "정산 월을 확인해 주세요 (예: 2026-12).") }),
  );
  const { periodId, result } = await calculate(getDb(), body.month, {
    actorId: viewer.userId,
    headers: request.headers,
  });
  return json({
    ok: true,
    periodId,
    instructors: result.instructors.length,
    skippedNoPolicy: result.skippedNoPolicy,
  });
});
