import { z } from "zod";
import { ApiError, json, parseBody, requireApiStaff, route } from "@/server/api";
import { getDb } from "@/server/db";
import { MemberError, setUserStatus } from "@/server/members";

export const POST = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  const viewer = await requireApiStaff(request, "operator");
  const { id } = await params;
  const body = await parseBody(
    request,
    z.object({
      status: z.enum(["active", "suspended"]),
      reason: z.string().trim().min(2, { error: "사유를 적어 주세요." }).max(500),
    }),
  );
  try {
    await setUserStatus(getDb(), { actorId: viewer.userId, userId: id, ...body, headers: request.headers });
  } catch (error) {
    if (error instanceof MemberError) throw new ApiError(400, error.code, error.message);
    throw error;
  }
  return json({ ok: true });
});
