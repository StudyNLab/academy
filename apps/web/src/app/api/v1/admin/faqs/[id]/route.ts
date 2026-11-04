import { json, parseBody, requireApiStaff, route, uuidParam } from "@/server/api";
import { getDb } from "@/server/db";
import { deleteFaq, saveFaq } from "@/server/notices";
import { faqInput } from "@/server/support-input";

type Context = { params: Promise<{ id: string }> };

// AD-12 자주 묻는 질문 고치기 · 지우기
export const POST = route<Context>(async (request, { params }) => {
  const viewer = await requireApiStaff(request, "operator");
  const id = uuidParam((await params).id);
  const body = await parseBody(request, faqInput);
  await saveFaq(getDb(), { ...body, id, actorId: viewer.userId, headers: request.headers });
  return json({ id });
});

export const DELETE = route<Context>(async (request, { params }) => {
  const viewer = await requireApiStaff(request, "operator");
  const id = uuidParam((await params).id);
  await deleteFaq(getDb(), { id, actorId: viewer.userId, headers: request.headers });
  return json({ ok: true });
});
