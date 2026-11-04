import { json, parseBody, requireApiViewer, route } from "@/server/api";
import { getDb } from "@/server/db";
import { createInquiry } from "@/server/inquiries";
import { inquiryInput } from "@/server/support-input";

// M-05 1:1 문의 쓰기
export const POST = route(async (request) => {
  const viewer = await requireApiViewer(request);
  const body = await parseBody(request, inquiryInput);
  return json({ id: await createInquiry(getDb(), viewer, body) });
});
