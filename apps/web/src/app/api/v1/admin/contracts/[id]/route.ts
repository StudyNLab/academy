import { json, requireApiStaff, route, uuidParam } from "@/server/api";
import { getDb } from "@/server/db";
import { removeContract } from "@/server/instructors";

// AD-15 강사가 동의하기 전의 계약 지우기 (잘못 만든 것)
export const DELETE = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  const viewer = await requireApiStaff(request, "operator");
  await removeContract(getDb(), uuidParam((await params).id), {
    actorId: viewer.userId,
    headers: request.headers,
  });
  return json({ ok: true });
});
