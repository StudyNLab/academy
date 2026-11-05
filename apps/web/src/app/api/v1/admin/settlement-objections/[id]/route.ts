import { z } from "zod";
import { json, parseBody, requireApiStaff, route, uuidParam } from "@/server/api";
import { getDb } from "@/server/db";
import { answer } from "@/server/settlements";

// AD-16 이의 신청 답변. 고칠 금액이 있으면 다음 달 정산의 조정으로 (확정한 정산은 바뀌지 않는다)
export const POST = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  const viewer = await requireApiStaff(request, "operator");
  const id = uuidParam((await params).id);
  const body = await parseBody(
    request,
    z.object({
      answer: z.string().trim().min(2, "답변을 적어 주세요.").max(2000),
      adjustment: z.number().int("조정 금액은 원 단위 정수로 적어 주세요.").default(0),
    }),
  );
  await answer(getDb(), id, { ...body, actorId: viewer.userId, headers: request.headers });
  return json({ ok: true });
});
