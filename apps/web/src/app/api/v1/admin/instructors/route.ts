import { z } from "zod";
import { json, parseBody, requireApiStaff, route } from "@/server/api";
import { createInstructor } from "@/server/courses";
import { getDb } from "@/server/db";

export const POST = route(async (request) => {
  const viewer = await requireApiStaff(request, "operator");
  const body = await parseBody(request, z.object({ displayName: z.string().trim().min(2).max(50) }));
  const row = await createInstructor(getDb(), { ...body, actorId: viewer.userId, headers: request.headers });
  return json({ id: row.id }, 201);
});
