import { Readable } from "node:stream";
import { getAuth } from "@/server/auth-instance";
import { contentAsset, isPreviewImage } from "@/server/catalog";
import { getDb } from "@/server/db";
import { canLearn, viewAccess } from "@/server/entitlements";
import { getStore } from "@/server/storage";
import { loadViewer } from "@/server/viewer";

// 교재 그림. 공개 중인 버전: 무료 미리보기에 나오는 그림은 누구나, 나머지는 강의를 볼 수 있는 사람(수강권 · 운영자 ·
// 그 과정 강사)만 (M4, 수강권 판단 함수 하나로). 공개 전 버전(검수 중 등)의 그림은 운영자만.
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
  let cache = "public, max-age=3600";
  if (!asset.isPublished) {
    const viewer = await loadViewer(getAuth(), db, request.headers);
    if (!viewer?.roles.includes("operator")) return new Response(null, { status: 404 });
    cache = "private, no-store";
  } else if (!(await isPreviewImage(db, asset.course.id, versionId, assetPath))) {
    const viewer = await loadViewer(getAuth(), db, request.headers);
    if (!canLearn(await viewAccess(db, viewer, asset.course))) return new Response(null, { status: 404 });
    // 사람마다 다르다: 공유 캐시에 두지 않는다 (버전마다 주소가 달라 내용은 바뀌지 않는다)
    cache = "private, max-age=86400, immutable";
  }
  const object = await getStore().get(asset.objectKey);
  if (!object) return new Response(null, { status: 404 });
  return new Response(Readable.toWeb(object.body) as ReadableStream, {
    headers: {
      "content-type": "image/webp",
      "cache-control": cache,
      vary: "cookie",
      "x-content-type-options": "nosniff",
    },
  });
}
