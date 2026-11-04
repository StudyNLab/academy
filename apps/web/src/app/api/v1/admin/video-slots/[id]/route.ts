import { z } from "zod";
import { json, parseBody, requireApiStaff, route } from "@/server/api";
import { linkYoutube } from "@/server/courses";
import { getDb } from "@/server/db";

// AD-05 (일부): 영상 자리에 유튜브 주소 연결 · 끊기 (url: null)
export const POST = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  const viewer = await requireApiStaff(request, "operator");
  const { url } = await parseBody(request, z.object({ url: z.string().trim().max(300).nullable() }));
  await linkYoutube(getDb(), (await params).id, {
    url: url || null,
    actorId: viewer.userId,
    headers: request.headers,
  });
  return json({ ok: true });
});
