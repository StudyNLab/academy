import { json, requireApiViewer, route, uuidParam } from "@/server/api";
import { getDb } from "@/server/db";
import { withdrawRefundRequest } from "@/server/refunds";

// 환불 요청 거두기 (운영자가 처리하기 전만)
export const DELETE = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  const viewer = await requireApiViewer(request);
  await withdrawRefundRequest(getDb(), viewer, uuidParam((await params).id));
  return json({ ok: true });
});
