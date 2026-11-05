import { ApiError, requireApiStaff, route } from "@/server/api";
import { getDb } from "@/server/db";
import { requireInstructor } from "@/server/instructors";
import { myStatement, statementCsv } from "@/server/settlements";

// I-08 CSV 받기 (근거 줄 · 합계, 구매자 정보 없음)
export const GET = route<{ params: Promise<{ month: string }> }>(async (request, { params }) => {
  const viewer = await requireApiStaff(request, "instructor");
  const db = getDb();
  const instructor = await requireInstructor(db, viewer);
  const month = (await params).month;
  const statement = await myStatement(db, instructor, month, {
    actorId: viewer.userId,
    headers: request.headers,
  });
  if (!statement) throw new ApiError(404, "NOT_FOUND", "정산 명세를 찾을 수 없습니다.");
  return new Response(statementCsv(statement), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="aionit-settlement-${month}.csv"`,
      "cache-control": "no-store",
    },
  });
});
