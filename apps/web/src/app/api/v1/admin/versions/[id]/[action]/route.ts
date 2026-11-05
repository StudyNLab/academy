import { z } from "zod";
import { ApiError, json, parseBody, requireApiStaff, route, uuidParam } from "@/server/api";
import { publishVersion, rejectVersion, rollbackToVersion } from "@/server/courses";
import { getDb } from "@/server/db";
import { supportDeps } from "@/server/support-deps";

// AD-04 승인하고 공개 · 반려 · 되돌리기. 강사가 올린 버전이면 결과(반려 사유)가 강사에게 간다 (사이트 알림 · 메일)
export const POST = route<{ params: Promise<{ id: string; action: string }> }>(
  async (request, { params }) => {
    const viewer = await requireApiStaff(request, "operator");
    const { id: raw, action } = await params;
    const id = uuidParam(raw);
    const actor = { actorId: viewer.userId, headers: request.headers };
    const db = getDb();
    if (action === "publish") {
      const { note } = await parseBody(request, z.object({ note: z.string().trim().max(500).optional() }));
      await publishVersion(db, id, { ...actor, note }, supportDeps());
    } else if (action === "reject") {
      const { reason } = await parseBody(
        request,
        z.object({ reason: z.string().trim().min(2, { error: "반려 사유를 적어 주세요." }).max(1000) }),
      );
      await rejectVersion(db, id, { ...actor, reason }, supportDeps());
    } else if (action === "rollback") {
      await rollbackToVersion(db, id, actor);
    } else {
      throw new ApiError(404, "NOT_FOUND", "없는 작업입니다.");
    }
    return json({ ok: true });
  },
);
