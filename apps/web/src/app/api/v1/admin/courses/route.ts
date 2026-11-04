import { json, parseBody, requireApiStaff, route } from "@/server/api";
import { createCourseSchema } from "@/server/course-input";
import { createCourse } from "@/server/courses";
import { getDb } from "@/server/db";

// AD-02 과정 등록
export const POST = route(async (request) => {
  const viewer = await requireApiStaff(request, "operator");
  const body = await parseBody(request, createCourseSchema);
  const row = await createCourse(getDb(), { ...body, actorId: viewer.userId, headers: request.headers });
  return json({ id: row.id }, 201);
});
