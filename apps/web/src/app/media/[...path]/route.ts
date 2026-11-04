import { Readable } from "node:stream";
import { MEDIA_TOKEN_HEADER } from "@aionit/core/media";
import { getEnv } from "@/server/env";
import { getMediaStore } from "@/server/storage";
import { checkMediaRequest } from "@/server/videos";

// 영상 재생 목록 · 조각 · 자막. 테스트 서버는 Caddy 가 이 주소를 가로채 토큰 확인(/api/v1/media/check) 후 Garage 에서
// 바로 내주므로 여기까지 오지 않는다. Caddy 가 없는 개발 서버에서만 같은 확인을 하고 영상 버킷에서 읽어 준다.
export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = {
  m3u8: "application/vnd.apple.mpegurl",
  ts: "video/mp2t",
  vtt: "text/vtt; charset=utf-8",
};

export async function GET(request: Request) {
  const result = checkMediaRequest(
    getEnv().BETTER_AUTH_SECRET,
    request.headers.get(MEDIA_TOKEN_HEADER),
    new URL(request.url).pathname,
  );
  if (!result.ok)
    return new Response(null, { status: result.status, headers: { "cache-control": "no-store" } });
  const object = await getMediaStore().get(result.objectPath);
  if (!object) return new Response(null, { status: 404 });
  return new Response(Readable.toWeb(object.body) as ReadableStream, {
    headers: {
      "content-type": TYPES[result.objectPath.split(".").pop() ?? ""] ?? "application/octet-stream",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
