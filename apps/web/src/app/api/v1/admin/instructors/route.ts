import { z } from "zod";
import { json, parseBody, requireApiStaff, route } from "@/server/api";
import { getDb } from "@/server/db";
import { registerInstructor } from "@/server/instructors";
import { supportDeps } from "@/server/support-deps";

// AD-15 강사 등록. 가입한 회원의 이메일을 주면 그 회원을 잇고 강사 역할을 준다 (비우면 프로필만)
export const POST = route(async (request) => {
  const viewer = await requireApiStaff(request, "operator");
  const body = await parseBody(
    request,
    z.object({
      displayName: z.string().trim().min(2).max(50),
      email: z.email("이메일 주소를 확인해 주세요.").max(254).nullish().or(z.literal("")),
    }),
  );
  const row = await registerInstructor(getDb(), supportDeps(), {
    displayName: body.displayName,
    email: body.email || null,
    actorId: viewer.userId,
    headers: request.headers,
  });
  return json({ id: row.id }, 201);
});
