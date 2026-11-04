import { z } from "zod";
import { json, parseBody, requireApiStaff, route } from "@/server/api";
import { getDb } from "@/server/db";
import { grantEntitlement } from "@/server/entitlements";

// AD-08 수강권 수동 발급 (사유 필수)
export const POST = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  const viewer = await requireApiStaff(request, "operator");
  const body = await parseBody(
    request,
    z.object({
      courseId: z.uuid({ error: "과정을 골라 주세요." }),
      days: z.number().int().min(1).max(3650).nullable(),
      reason: z.string().trim().min(2, { error: "사유를 적어 주세요." }).max(500),
    }),
  );
  const id = await grantEntitlement(getDb(), {
    actorId: viewer.userId,
    userId: (await params).id,
    ...body,
    headers: request.headers,
  });
  return json({ id });
});
