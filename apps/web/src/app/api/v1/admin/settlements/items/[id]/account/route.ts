import { json, requireApiStaff, route, uuidParam } from "@/server/api";
import { getDb } from "@/server/db";
import { getEnv } from "@/server/env";
import { payoutAccount } from "@/server/settlements";

// AD-16 지급할 때만: 계좌번호 원문 (부를 때마다 개인정보 조회 기록)
export const GET = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  const viewer = await requireApiStaff(request, "operator");
  const account = await payoutAccount(getDb(), getEnv().BETTER_AUTH_SECRET, uuidParam((await params).id), {
    actorId: viewer.userId,
    headers: request.headers,
  });
  return json({ account });
});
