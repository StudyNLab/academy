import { z } from "zod";
import { ApiError, json, parseBody, requireApiViewer, route } from "@/server/api";
import { getDb } from "@/server/db";
import { changeNickname, MemberError } from "@/server/members";

export const POST = route(async (request) => {
  const viewer = await requireApiViewer(request);
  const { nickname } = await parseBody(request, z.object({ nickname: z.string().max(100) }));
  try {
    return json({ nickname: await changeNickname(getDb(), viewer.userId, nickname) });
  } catch (error) {
    if (error instanceof MemberError) throw new ApiError(400, error.code, error.message);
    throw error;
  }
});
