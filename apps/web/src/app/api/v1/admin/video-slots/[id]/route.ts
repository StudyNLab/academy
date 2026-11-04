import { z } from "zod";
import { json, parseBody, requireApiStaff, route, uuidParam } from "@/server/api";
import { linkYoutube } from "@/server/courses";
import { getDb } from "@/server/db";
import { linkHosted } from "@/server/videos";

// AD-05: 영상 자리에 유튜브 주소(url) 또는 자체 서버 영상(assetId) 연결 · 끊기 (null)
export const POST = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  const viewer = await requireApiStaff(request, "operator");
  const body = await parseBody(
    request,
    z.union([
      z.object({ url: z.string().trim().max(300).nullable() }),
      z.object({ assetId: z.uuid().nullable() }),
    ]),
  );
  const slotId = uuidParam((await params).id);
  const actor = { actorId: viewer.userId, headers: request.headers };
  if ("assetId" in body) await linkHosted(getDb(), slotId, { assetId: body.assetId, ...actor });
  else await linkYoutube(getDb(), slotId, { url: body.url || null, ...actor });
  return json({ ok: true });
});
