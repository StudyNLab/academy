import { SESSION_POLICY } from "@aionit/core";
import { eq, schema } from "@aionit/db";
import { z } from "zod";
import { ApiError, json, parseBody, requireApiViewer, route } from "@/server/api";
import { getAuth } from "@/server/auth-instance";
import { getDb } from "@/server/db";
import { withdrawUser } from "@/server/withdraw";

export const POST = route(async (request) => {
  const viewer = await requireApiViewer(request);
  const body = await parseBody(
    request,
    z.object({
      confirm: z.literal("탈퇴합니다", { error: "확인 문구를 정확히 입력해 주세요." }),
      password: z.string().optional(),
    }),
  );
  const db = getDb();
  const accounts = await db
    .select({ providerId: schema.authAccounts.providerId })
    .from(schema.authAccounts)
    .where(eq(schema.authAccounts.userId, viewer.userId));
  if (accounts.some((a) => a.providerId === "credential")) {
    if (!body.password) throw new ApiError(400, "PASSWORD_REQUIRED", "비밀번호를 입력해 주세요.");
    const ok = await getAuth()
      .api.verifyPassword({ body: { password: body.password }, headers: request.headers })
      .then(() => true)
      .catch(() => false);
    if (!ok) throw new ApiError(400, "INVALID_PASSWORD", "비밀번호가 맞지 않습니다.");
  } else if (Date.now() - viewer.sessionCreatedAt.getTime() > SESSION_POLICY.recentLoginMs) {
    throw new ApiError(400, "RELOGIN_REQUIRED", "본인 확인을 위해 다시 로그인한 뒤 탈퇴해 주세요.");
  }
  await withdrawUser(db, viewer.userId, request.headers);
  const response = json({ withdrawn: true });
  // 세션은 DB 에서 지웠다. 브라우저의 쿠키도 지운다.
  for (const name of ["aionit.session_token", "__Secure-aionit.session_token"]) {
    response.headers.append("set-cookie", `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
  }
  return response;
});
