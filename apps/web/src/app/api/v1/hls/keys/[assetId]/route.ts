import { MEDIA_TOKEN_HEADER } from "@aionit/core/media";
import { getAuth } from "@/server/auth-instance";
import { getDb } from "@/server/db";
import { getEnv } from "@/server/env";
import { hlsKeyFor } from "@/server/videos";
import { loadViewer } from "@/server/viewer";

// 키 서버 (docs/기술설계.md 5.2 4단계): 재생 토큰(같은 사람 · 같은 영상) + 로그인 + 지금 수강권을 다시 확인한 뒤 16바이트 키.
// 실패 이유는 알려 주지 않는다 (403 하나)
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await params;
  const denied = new Response(null, { status: 403, headers: { "cache-control": "no-store" } });
  if (!UUID.test(assetId)) return denied;
  const db = getDb();
  const viewer = await loadViewer(getAuth(), db, request.headers);
  const key = await hlsKeyFor(
    db,
    viewer,
    assetId,
    request.headers.get(MEDIA_TOKEN_HEADER),
    getEnv().BETTER_AUTH_SECRET,
  );
  if (!key) return denied;
  return new Response(new Uint8Array(key), {
    headers: {
      "content-type": "application/octet-stream",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
