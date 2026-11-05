import { json, parseBody, requireApiStaff, route, uuidParam } from "@/server/api";
import { instructorCourseSchema } from "@/server/course-input";
import { getDb } from "@/server/db";
import { updateOwnCourse } from "@/server/instructors";

// I-02 과정 기본 정보 고치기 (소개 · 대상 · 준비물 등. 과정 ID · 구독 포함 · 가격은 운영자 몫)
export const POST = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  const viewer = await requireApiStaff(request, "instructor");
  const body = await parseBody(request, instructorCourseSchema);
  await updateOwnCourse(getDb(), viewer, uuidParam((await params).id), { ...body, headers: request.headers });
  return json({ ok: true });
});
