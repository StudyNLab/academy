import { parseRatePercent } from "@aionit/core";
import { z } from "zod";
import { ApiError, json, parseBody, requireApiStaff, route, uuidParam } from "@/server/api";
import { removeInstructor } from "@/server/courses";
import { getDb } from "@/server/db";
import {
  createContract,
  linkInstructorMember,
  setInstructorRate,
  setInstructorStatus,
} from "@/server/instructors";
import { supportDeps } from "@/server/support-deps";

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "날짜를 확인해 주세요.");

// AD-15 강사 관리: 회원 잇기 · 상태(정지 · 계약 끝남) · 계약 만들기 · 수익 비율(새 버전)
export const POST = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  const viewer = await requireApiStaff(request, "operator");
  const id = uuidParam((await params).id);
  const actor = { actorId: viewer.userId, headers: request.headers };
  const body = await parseBody(
    request,
    z.discriminatedUnion("action", [
      z.object({ action: z.literal("link"), email: z.email("이메일 주소를 확인해 주세요.").max(254) }),
      z.object({
        action: z.literal("status"),
        status: z.enum(["active", "suspended", "ended"]),
        reason: z.string().trim().min(2, "사유를 적어 주세요.").max(500),
      }),
      z.object({
        action: z.literal("contract"),
        startsOn: DATE,
        endsOn: DATE.nullish().or(z.literal("")),
        memo: z.string().max(1000).default(""),
      }),
      z.object({
        action: z.literal("rate"),
        percent: z.string().max(10),
        effectiveOn: DATE,
        note: z.string().max(500).default(""),
      }),
    ]),
  );
  const db = getDb();
  switch (body.action) {
    case "link":
      await linkInstructorMember(db, supportDeps(), id, { email: body.email, ...actor });
      break;
    case "status":
      await setInstructorStatus(db, id, { status: body.status, reason: body.reason, ...actor });
      break;
    case "contract":
      await createContract(db, supportDeps(), id, {
        startsOn: body.startsOn,
        endsOn: body.endsOn || null,
        memo: body.memo,
        ...actor,
      });
      break;
    case "rate": {
      const bp = parseRatePercent(body.percent);
      if (bp === null)
        throw new ApiError(400, "BAD_RATE", "비율은 0 ~ 100 사이 숫자로 적어 주세요 (예: 60).");
      await setInstructorRate(db, id, {
        singleRateBp: bp,
        effectiveOn: body.effectiveOn,
        note: body.note,
        ...actor,
      });
      break;
    }
  }
  return json({ ok: true });
});

// 운영자: 강사 지우기 (그 강사로 된 과정이 없을 때만)
export const DELETE = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  const viewer = await requireApiStaff(request, "operator");
  await removeInstructor(getDb(), uuidParam((await params).id), {
    actorId: viewer.userId,
    headers: request.headers,
  });
  return json({ ok: true });
});
