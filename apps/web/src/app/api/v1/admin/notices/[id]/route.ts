import { json, parseBody, requireApiStaff, route, uuidParam } from "@/server/api";
import { getDb } from "@/server/db";
import { deleteNotice, saveNotice } from "@/server/notices";
import { noticeInput } from "@/server/support-input";

type Context = { params: Promise<{ id: string }> };

// AD-12 공지 고치기 · 지우기
export const POST = route<Context>(async (request, { params }) => {
  const viewer = await requireApiStaff(request, "operator");
  const id = uuidParam((await params).id);
  const body = await parseBody(request, noticeInput);
  await saveNotice(getDb(), { ...body, id, actorId: viewer.userId, headers: request.headers });
  return json({ id });
});

export const DELETE = route<Context>(async (request, { params }) => {
  const viewer = await requireApiStaff(request, "operator");
  const id = uuidParam((await params).id);
  await deleteNotice(getDb(), { id, actorId: viewer.userId, headers: request.headers });
  return json({ ok: true });
});
