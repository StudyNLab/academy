import { json, requireApiStaff, route } from "@/server/api";
import { getDb } from "@/server/db";
import { confirm } from "@/server/settlements";

// AD-16 확정 ➔ 강사에게 명세 공개. 확정한 뒤에는 바뀌지 않는다
export const POST = route<{ params: Promise<{ month: string }> }>(async (request, { params }) => {
  const viewer = await requireApiStaff(request, "operator");
  const done = await confirm(getDb(), (await params).month, {
    actorId: viewer.userId,
    headers: request.headers,
  });
  return json({ ok: true, payOn: done.payOn, objectionUntil: done.objectionUntil });
});
