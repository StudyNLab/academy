import { z } from "zod";
import { json, parseBody, requireApiStaff, route } from "@/server/api";
import { setPreviewRule } from "@/server/courses";
import { getDb } from "@/server/db";

// AD-06 무료 미리보기 지정 (챕터 전체 · 일부 Section · 끄기)
export const POST = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  const viewer = await requireApiStaff(request, "operator");
  const body = await parseBody(
    request,
    z.object({
      chapterKey: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,40}$/),
      scope: z.enum(["whole", "sections", "none"]),
      sectionIds: z
        .array(z.string().regex(/^sec-\d+$/))
        .max(100)
        .optional(),
    }),
  );
  await setPreviewRule(getDb(), (await params).id, {
    ...body,
    actorId: viewer.userId,
    headers: request.headers,
  });
  return json({ ok: true });
});
