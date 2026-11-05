import { json, parseBody, requireApiStaff, route } from "@/server/api";
import { getDb } from "@/server/db";
import { createPolicyVersion, policyInput } from "@/server/policies";

// AD-12 정책 문서 새 버전 (시행일을 정해 게시, 시행 전에는 "시행 예정" 으로 보인다)
export const POST = route(async (request) => {
  const viewer = await requireApiStaff(request, "operator");
  const body = await parseBody(request, policyInput);
  const row = await createPolicyVersion(getDb(), {
    ...body,
    actorId: viewer.userId,
    headers: request.headers,
  });
  return json({ id: row.id });
});
