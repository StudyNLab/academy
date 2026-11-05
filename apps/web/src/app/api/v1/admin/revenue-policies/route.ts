import { parseRatePercent } from "@aionit/core";
import { z } from "zod";
import { ApiError, json, parseBody, requireApiStaff, route } from "@/server/api";
import { getDb } from "@/server/db";
import { createPolicy } from "@/server/settlements";

const percent = (value: string | null | undefined, label: string) => {
  if (value === null || value === undefined || value.trim() === "") return null;
  const bp = parseRatePercent(value);
  if (bp === null)
    throw new ApiError(400, "BAD_RATE", `${label}은 0 ~ 100 사이 숫자로 적어 주세요 (예: 60).`);
  return bp;
};

// AD-16 배분 정책 새 버전 (기본 정책 · 과정 예외). 강사별 단건 비율은 AD-15
export const POST = route(async (request) => {
  const viewer = await requireApiStaff(request, "operator");
  const body = await parseBody(
    request,
    z.object({
      scope: z.enum(["default", "course"]),
      courseId: z.uuid().nullish(),
      singleRate: z.string().max(10).nullish(),
      poolRate: z.string().max(10).nullish(),
      pgFeeRate: z.string().max(10).nullish(),
      dailyCapHours: z.string().max(5).nullish(),
      effectiveOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "시행일을 확인해 주세요."),
      note: z.string().max(200).default(""),
    }),
  );
  const cap = body.dailyCapHours?.trim() ? Number(body.dailyCapHours) : null;
  if (cap !== null && !Number.isFinite(cap))
    throw new ApiError(400, "BAD_CAP", "하루 상한은 시간 숫자로 적어 주세요 (예: 3).");
  const row = await createPolicy(getDb(), {
    scope: body.scope,
    courseId: body.courseId ?? null,
    singleRateBp: percent(body.singleRate, "단건 비율"),
    poolRateBp: percent(body.poolRate, "구독 풀 비율"),
    pgFeeRateBp: percent(body.pgFeeRate, "추정 수수료율"),
    dailyCapHours: cap,
    effectiveOn: body.effectiveOn,
    note: body.note,
    actorId: viewer.userId,
    headers: request.headers,
  });
  return json({ ok: true, id: row.id });
});
