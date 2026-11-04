import { ApiError, json, requireApiStaff, route } from "@/server/api";
import { courseDeps } from "@/server/course-deps";
import { MAX_PACKAGE_BYTES, uploadPackage } from "@/server/courses";

// AD-03 교재 패키지 올리기 (multipart, 필드 이름 package). 검사 · 정리는 worker 가 이어서 한다
export const POST = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  const viewer = await requireApiStaff(request, "operator");
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_PACKAGE_BYTES + 1024 * 1024) {
    throw new ApiError(413, "TOO_LARGE", "패키지는 200MB 까지 올릴 수 있습니다.");
  }
  const form = await request.formData().catch(() => null);
  const file = form?.get("package");
  if (!(file instanceof File)) throw new ApiError(400, "NO_FILE", "zip 파일을 골라 주세요.");
  const version = await uploadPackage(courseDeps(), {
    courseId: (await params).id,
    zip: Buffer.from(await file.arrayBuffer()),
    fileName: file.name,
    actorId: viewer.userId,
    headers: request.headers,
  });
  return json({ id: version.id, version: version.version }, 202);
});
