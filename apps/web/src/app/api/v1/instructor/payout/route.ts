import { z } from "zod";
import { json, parseBody, requireApiStaff, route } from "@/server/api";
import { getDb } from "@/server/db";
import { getEnv } from "@/server/env";
import { savePayoutProfile } from "@/server/instructors";

// I-09 정산 정보 (소득 구분 · 주민등록번호 또는 사업자등록번호 · 지급 계좌). 원문은 돌려주지 않는다
export const POST = route(async (request) => {
  const viewer = await requireApiStaff(request, "instructor");
  const body = await parseBody(
    request,
    z.object({
      taxType: z.enum(["individual", "business"]),
      rrn: z.string().max(20).nullish(),
      businessNo: z.string().max(20).nullish(),
      bankName: z.string().trim().max(30),
      bankAccount: z.string().max(30),
      accountHolder: z.string().trim().max(50),
    }),
  );
  await savePayoutProfile(getDb(), getEnv().BETTER_AUTH_SECRET, viewer, {
    ...body,
    headers: request.headers,
  });
  return json({ ok: true });
});
