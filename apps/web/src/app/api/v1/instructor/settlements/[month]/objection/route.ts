import { z } from "zod";
import { ApiError, json, parseBody, requireApiStaff, route } from "@/server/api";
import { getDb } from "@/server/db";
import { requireInstructor } from "@/server/instructors";
import { myStatements, objectAs } from "@/server/settlements";

// I-08 이의 신청 (명세 공개 뒤 5일). 계약이 끝난 강사도 자기 정산에는 이의 신청할 수 있다
export const POST = route<{ params: Promise<{ month: string }> }>(async (request, { params }) => {
  const viewer = await requireApiStaff(request, "instructor");
  const db = getDb();
  const instructor = await requireInstructor(db, viewer);
  const month = (await params).month;
  const body = await parseBody(request, z.object({ body: z.string().max(2000) }));
  const target = (await myStatements(db, instructor)).find((s) => s.month === month);
  if (!target) throw new ApiError(404, "NOT_FOUND", "정산 명세를 찾을 수 없습니다.");
  await objectAs(db, instructor, target.settlement.id, {
    body: body.body,
    userId: viewer.userId,
    headers: request.headers,
  });
  return json({ ok: true });
});
