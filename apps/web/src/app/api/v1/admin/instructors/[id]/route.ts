import { json, requireApiStaff, route } from "@/server/api";
import { removeInstructor } from "@/server/courses";
import { getDb } from "@/server/db";

// 운영자: 강사 지우기 (그 강사로 된 과정이 없을 때만)
export const DELETE = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  const viewer = await requireApiStaff(request, "operator");
  await removeInstructor(getDb(), (await params).id, { actorId: viewer.userId, headers: request.headers });
  return json({ ok: true });
});
