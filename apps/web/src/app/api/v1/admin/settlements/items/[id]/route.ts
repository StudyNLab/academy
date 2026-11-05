import { z } from "zod";
import { json, parseBody, requireApiStaff, route, uuidParam } from "@/server/api";
import { getDb } from "@/server/db";
import { payout } from "@/server/settlements";

// AD-16 지급 기록 (시스템 밖 계좌이체를 한 뒤): 일자 · 메모. 금액은 지급 예정액 그대로
export const POST = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  const viewer = await requireApiStaff(request, "operator");
  const id = uuidParam((await params).id);
  const body = await parseBody(
    request,
    z.object({
      paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "지급일을 확인해 주세요."),
      memo: z.string().max(500).default(""),
    }),
  );
  const row = await payout(getDb(), id, { ...body, actorId: viewer.userId, headers: request.headers });
  return json({ ok: true, payoutId: row.id });
});
