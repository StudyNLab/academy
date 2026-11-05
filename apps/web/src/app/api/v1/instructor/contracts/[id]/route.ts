import { json, requireApiStaff, route, uuidParam } from "@/server/api";
import { getDb } from "@/server/db";
import { signContract } from "@/server/instructors";

// I-09 계약 · 강사 이용약관 동의
export const POST = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  const viewer = await requireApiStaff(request, "instructor");
  await signContract(getDb(), viewer, uuidParam((await params).id), { headers: request.headers });
  return json({ ok: true });
});
