import { json, requireApiStaff, route, uuidParam } from "@/server/api";
import { getDb } from "@/server/db";
import { deletePolicyVersion } from "@/server/policies";

type Context = { params: Promise<{ id: string }> };

// AD-12 시행 전 정책 문서 버전 지우기
export const DELETE = route<Context>(async (request, { params }) => {
  const viewer = await requireApiStaff(request, "operator");
  const id = uuidParam((await params).id);
  await deletePolicyVersion(getDb(), { id, actorId: viewer.userId, headers: request.headers });
  return json({ ok: true });
});
