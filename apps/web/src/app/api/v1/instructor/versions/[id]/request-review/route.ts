import { z } from "zod";
import { json, parseBody, requireApiStaff, route, uuidParam } from "@/server/api";
import { getDb } from "@/server/db";
import { requestReview } from "@/server/instructors";

// I-05 검수 요청 (변경 내용 메모와 함께). 운영자가 AD-04 에서 공개 · 반려한다
export const POST = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  const viewer = await requireApiStaff(request, "instructor");
  const { note } = await parseBody(
    request,
    z.object({ note: z.string().trim().max(1000, "메모는 1000자까지입니다.").default("") }),
  );
  await requestReview(getDb(), viewer, uuidParam((await params).id), { note, headers: request.headers });
  return json({ ok: true });
});
