import { z } from "zod";
import { json, parseBody, requireApiStaff, route } from "@/server/api";
import { getDb } from "@/server/db";
import { updateProfile } from "@/server/instructors";

// I-09 공개 프로필 (강의 상세 · 강사 소개에 나온다)
export const POST = route(async (request) => {
  const viewer = await requireApiStaff(request, "instructor");
  const body = await parseBody(
    request,
    z.object({
      displayName: z.string().trim().min(2, "이름을 2자 이상 적어 주세요.").max(50, "이름은 50자까지입니다."),
      bioMd: z.string().max(3000, "소개는 3000자까지입니다."),
    }),
  );
  await updateProfile(getDb(), viewer, { ...body, headers: request.headers });
  return json({ ok: true });
});
