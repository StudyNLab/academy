import { z } from "zod";
import { json, parseBody, requireApiStaff, route } from "@/server/api";
import { getDb } from "@/server/db";
import { adjustEntitlement, revokeEntitlement } from "@/server/entitlements";

const reason = z.string().trim().min(2, { error: "사유를 적어 주세요." }).max(500);

// AD-08 수강권 회수 · 기간 조정 (사유 필수)
export const POST = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  const viewer = await requireApiStaff(request, "operator");
  const { id } = await params;
  const body = await parseBody(
    request,
    z.discriminatedUnion("action", [
      z.object({ action: z.literal("revoke"), reason }),
      // 끝나는 날(KST 날짜)의 하루 끝까지. null 이면 무제한
      z.object({ action: z.literal("adjust"), endsOn: z.iso.date().nullable(), reason }),
    ]),
  );
  const db = getDb();
  if (body.action === "revoke") {
    await revokeEntitlement(db, {
      actorId: viewer.userId,
      id,
      reason: body.reason,
      headers: request.headers,
    });
  } else {
    const endsAt = body.endsOn
      ? new Date(new Date(`${body.endsOn}T00:00:00+09:00`).getTime() + 86_400_000)
      : null;
    await adjustEntitlement(db, {
      actorId: viewer.userId,
      id,
      endsAt,
      reason: body.reason,
      headers: request.headers,
    });
  }
  return json({ ok: true });
});
