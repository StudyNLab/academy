import { Readable } from "node:stream";
import { ApiError, requireApiViewer, route } from "@/server/api";
import { getDb } from "@/server/db";
import { attachmentForLearner } from "@/server/learning";
import { getStore } from "@/server/storage";

// 첨부 자료 받기 (L-04): 수강권이 있어야 하고, 받은 기록(attachment_downloads)을 남긴다
export const GET = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  const viewer = await requireApiViewer(request);
  const row = await attachmentForLearner(getDb(), viewer, (await params).id);
  const object = await getStore().get(row.objectKey);
  if (!object) throw new ApiError(404, "NOT_FOUND", "파일을 찾을 수 없습니다.");
  const name = encodeURIComponent(row.name ?? `${row.title}.zip`);
  return new Response(Readable.toWeb(object.body) as ReadableStream, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename*=UTF-8''${name}`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
});
