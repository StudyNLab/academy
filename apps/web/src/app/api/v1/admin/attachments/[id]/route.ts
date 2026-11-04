import { Readable } from "node:stream";
import { eq, schema } from "@aionit/db";
import { ApiError, json, requireApiStaff, route } from "@/server/api";
import { removeAttachment } from "@/server/courses";
import { getDb } from "@/server/db";
import { getStore } from "@/server/storage";

// 운영자: 첨부 자료 받기 (기록 없이) · 지우기. 수강생은 /api/v1/learn/attachments/[id]
export const GET = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  await requireApiStaff(request, "operator");
  const [row] = await getDb()
    .select({
      objectKey: schema.files.objectKey,
      name: schema.files.originalName,
      title: schema.attachments.title,
    })
    .from(schema.attachments)
    .innerJoin(schema.files, eq(schema.files.id, schema.attachments.fileId))
    .where(eq(schema.attachments.id, (await params).id));
  const object = row ? await getStore().get(row.objectKey) : null;
  if (!row || !object) throw new ApiError(404, "NOT_FOUND", "파일을 찾을 수 없습니다.");
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

export const DELETE = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  const viewer = await requireApiStaff(request, "operator");
  await removeAttachment(getDb(), (await params).id, { actorId: viewer.userId, headers: request.headers });
  return json({ ok: true });
});
