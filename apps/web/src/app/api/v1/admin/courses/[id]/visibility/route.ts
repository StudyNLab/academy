import { z } from "zod";
import { json, parseBody, requireApiStaff, route } from "@/server/api";
import { setCourseHidden } from "@/server/courses";
import { getDb } from "@/server/db";

export const POST = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  const viewer = await requireApiStaff(request, "operator");
  const { hidden } = await parseBody(request, z.object({ hidden: z.boolean() }));
  await setCourseHidden(getDb(), (await params).id, hidden, {
    actorId: viewer.userId,
    headers: request.headers,
  });
  return json({ ok: true });
});
