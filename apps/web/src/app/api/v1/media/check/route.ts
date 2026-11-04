import { MEDIA_TOKEN_HEADER } from "@aionit/core/media";
import { getEnv } from "@/server/env";
import { checkMediaRequest } from "@/server/videos";

// Caddy forward_auth (infra/app-vm/Caddyfile): /media/* 요청마다 토큰을 확인한다. 200 이면 Caddy 가 Garage 에서 내준다.
// 원래 주소는 X-Forwarded-Uri 로 온다. DB 를 보지 않는다 (조각 요청이 많다)
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const result = checkMediaRequest(
    getEnv().BETTER_AUTH_SECRET,
    request.headers.get(MEDIA_TOKEN_HEADER),
    request.headers.get("x-forwarded-uri") ?? "",
  );
  return new Response(null, {
    status: result.ok ? 200 : result.status,
    headers: { "cache-control": "no-store" },
  });
}
