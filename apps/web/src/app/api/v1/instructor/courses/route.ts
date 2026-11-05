import { json, parseBody, requireApiStaff, route } from "@/server/api";
import { instructorCreateCourseSchema } from "@/server/course-input";
import { getDb } from "@/server/db";
import { createOwnCourse } from "@/server/instructors";

// I-02 강사가 과정 만들기 (작성 중으로 생긴다. 구독 포함 · 가격 · 공개는 운영자가 정한다)
export const POST = route(async (request) => {
  const viewer = await requireApiStaff(request, "instructor");
  const body = await parseBody(request, instructorCreateCourseSchema);
  const row = await createOwnCourse(getDb(), viewer, { ...body, headers: request.headers });
  return json({ id: row.id }, 201);
});
