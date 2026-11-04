import { ApiError, json, requireApiStaff, route } from "@/server/api";
import { courseDeps } from "@/server/course-deps";
import { addAttachment, MAX_ATTACHMENT_BYTES } from "@/server/courses";

// 첨부 자료 등록 (챕터별 실습 파일 zip). multipart: file, title, chapterKey(비우면 과정 전체)
export const POST = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  const viewer = await requireApiStaff(request, "operator");
  if (Number(request.headers.get("content-length") ?? 0) > MAX_ATTACHMENT_BYTES + 1024 * 1024) {
    throw new ApiError(413, "TOO_LARGE", "첨부 파일은 100MB 까지입니다.");
  }
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const title = String(form?.get("title") ?? "").trim();
  const chapterKey = String(form?.get("chapterKey") ?? "").trim();
  if (!(file instanceof File)) throw new ApiError(400, "NO_FILE", "zip 파일을 골라 주세요.");
  if (title.length < 2 || title.length > 100)
    throw new ApiError(400, "BAD_TITLE", "제목을 2 ~ 100자로 적어 주세요.");
  if (chapterKey && !/^[a-z0-9][a-z0-9_-]{0,40}$/.test(chapterKey)) {
    throw new ApiError(400, "BAD_CHAPTER", "챕터를 확인해 주세요.");
  }
  const row = await addAttachment(courseDeps(), {
    courseId: (await params).id,
    chapterKey: chapterKey || null,
    title,
    file: Buffer.from(await file.arrayBuffer()),
    fileName: file.name,
    actorId: viewer.userId,
    headers: request.headers,
  });
  return json({ id: row.id }, 201);
});
