import { json, parseBody, requireApiViewer, route } from "@/server/api";
import { getDb } from "@/server/db";
import { reportPost } from "@/server/qna";
import { reportInput } from "@/server/support-input";

// 신고 (같은 글은 한 번만)
export const POST = route(async (request) => {
  const viewer = await requireApiViewer(request);
  const body = await parseBody(request, reportInput);
  return json(await reportPost(getDb(), viewer, body));
});
