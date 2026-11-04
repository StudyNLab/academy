import { json, parseBody, requireApiStaff, route } from "@/server/api";
import { updateCourseSchema } from "@/server/course-input";
import { updateCourse } from "@/server/courses";
import { getDb } from "@/server/db";

// AD-02 과정 정보 고치기 (과정 ID 는 바꿀 수 없다)
export const POST = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  const viewer = await requireApiStaff(request, "operator");
  const body = await parseBody(request, updateCourseSchema);
  await updateCourse(getDb(), (await params).id, {
    ...body,
    actorId: viewer.userId,
    headers: request.headers,
  });
  return json({ ok: true });
});
