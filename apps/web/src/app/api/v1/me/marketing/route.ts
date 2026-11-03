import { z } from "zod";
import { json, parseBody, requireApiViewer, route } from "@/server/api";
import { setMarketingConsent } from "@/server/consents";
import { getDb } from "@/server/db";
import { clientIp } from "@/server/records";

export const POST = route(async (request) => {
  const viewer = await requireApiViewer(request);
  const { agreed } = await parseBody(request, z.object({ agreed: z.boolean() }));
  await setMarketingConsent(getDb(), viewer.userId, agreed, clientIp(request.headers));
  return json({ agreed });
});
