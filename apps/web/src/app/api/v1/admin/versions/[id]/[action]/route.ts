import { z } from "zod";
import { ApiError, json, parseBody, requireApiStaff, route } from "@/server/api";
import { publishVersion, rejectVersion, rollbackToVersion } from "@/server/courses";
import { getDb } from "@/server/db";

// AD-04 승인하고 공개 · 반려 · 되돌리기
export const POST = route<{ params: Promise<{ id: string; action: string }> }>(
  async (request, { params }) => {
    const viewer = await requireApiStaff(request, "operator");
    const { id, action } = await params;
    const actor = { actorId: viewer.userId, headers: request.headers };
    const db = getDb();
    if (action === "publish") {
      const { note } = await parseBody(request, z.object({ note: z.string().trim().max(500).optional() }));
      await publishVersion(db, id, { ...actor, note });
    } else if (action === "reject") {
      const { reason } = await parseBody(
        request,
        z.object({ reason: z.string().trim().min(2, { error: "반려 사유를 적어 주세요." }).max(1000) }),
      );
      await rejectVersion(db, id, { ...actor, reason });
    } else if (action === "rollback") {
      await rollbackToVersion(db, id, actor);
    } else {
      throw new ApiError(404, "NOT_FOUND", "없는 작업입니다.");
    }
    return json({ ok: true });
  },
);
