import { getAuth } from "@/server/auth-instance";

// Better Auth 의 로그인 · 가입 · 인증 메일 · 2단계 인증 API (/api/v1/auth/*). 설정은 src/server/auth.ts
export const dynamic = "force-dynamic";

function handler(request: Request) {
  return getAuth().handler(request);
}

export { handler as GET, handler as POST };
