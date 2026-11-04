import { json, parseBody, requireApiStaff, route } from "@/server/api";
import { getDb } from "@/server/db";
import { saveFaq } from "@/server/notices";
import { faqInput } from "@/server/support-input";

// AD-12 자주 묻는 질문 더하기
export const POST = route(async (request) => {
  const viewer = await requireApiStaff(request, "operator");
  const body = await parseBody(request, faqInput);
  return json({ id: await saveFaq(getDb(), { ...body, actorId: viewer.userId, headers: request.headers }) });
});
