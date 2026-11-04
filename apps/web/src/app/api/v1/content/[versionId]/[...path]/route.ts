import { Readable } from "node:stream";
import { getAuth } from "@/server/auth-instance";
import { contentAsset } from "@/server/catalog";
import { getDb } from "@/server/db";
import { getStore } from "@/server/storage";
import { loadViewer } from "@/server/viewer";

// 교재 그림. 공개 중인 버전의 그림은 누구나 (본문 글은 무료 미리보기 범위만 보이고, 그림 접근도 M3 수강권 판단 때 좁힌다).
// 공개 전 버전(검수 중 등)의 그림은 운영자만.
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ versionId: string; path: string[] }> },
) {
  const { versionId, path } = await params;
  const assetPath = path.map((p) => decodeURIComponent(p)).join("/");
  if (!UUID.test(versionId) || !/^images\/[^/]+$/.test(assetPath)) return new Response(null, { status: 404 });
  const db = getDb();
  const asset = await contentAsset(db, versionId, assetPath);
  if (!asset) return new Response(null, { status: 404 });
  if (!asset.isPublished) {
    const viewer = await loadViewer(getAuth(), db, request.headers);
    if (!viewer?.roles.includes("operator")) return new Response(null, { status: 404 });
  }
  const object = await getStore().get(asset.objectKey);
  if (!object) return new Response(null, { status: 404 });
  return new Response(Readable.toWeb(object.body) as ReadableStream, {
    headers: {
      "content-type": "image/webp",
      // 버전마다 주소가 달라 내용이 바뀌지 않는다
      "cache-control": asset.isPublished ? "public, max-age=86400, immutable" : "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
