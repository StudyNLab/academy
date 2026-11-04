import { z } from "zod";
import { json, parseBody, requireApiStaff, route, uuidParam } from "@/server/api";
import { videoDeps } from "@/server/course-deps";
import { startVideoUpload } from "@/server/videos";

// AD-05: 자체 서버 영상 올리기 시작 ➔ 조각마다 PUT /admin/videos/{id}/parts/{n} ➔ POST /admin/videos/{id}/complete
export const POST = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  const viewer = await requireApiStaff(request, "operator");
  const body = await parseBody(
    request,
    z.object({
      title: z.string().trim().min(2, "제목을 2자 이상 적어 주세요.").max(100, "제목은 100자까지입니다."),
      fileName: z.string().min(1).max(300),
      size: z.number().int().positive(),
    }),
  );
  const result = await startVideoUpload(videoDeps(), {
    courseId: uuidParam((await params).id),
    ...body,
    actorId: viewer.userId,
    headers: request.headers,
  });
  return json(result, 201);
});
