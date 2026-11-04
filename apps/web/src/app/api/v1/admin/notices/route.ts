import { json, parseBody, requireApiStaff, route } from "@/server/api";
import { getDb } from "@/server/db";
import { saveNotice } from "@/server/notices";
import { noticeInput } from "@/server/support-input";

// AD-12 공지 쓰기
export const POST = route(async (request) => {
  const viewer = await requireApiStaff(request, "operator");
  const body = await parseBody(request, noticeInput);
  return json({
    id: await saveNotice(getDb(), { ...body, actorId: viewer.userId, headers: request.headers }),
  });
});
