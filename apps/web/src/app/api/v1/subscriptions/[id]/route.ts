import { z } from "zod";
import {
  activateSubscription,
  agreePriceChange,
  changeCard,
  scheduleCancel,
  undoCancel,
} from "@aionit/payments";
import { and, eq, schema } from "@aionit/db";
import { json, parseBody, requireApiViewer, route, uuidParam } from "@/server/api";
import { getEnv } from "@/server/env";
import { billingClientKey, fakeMode, subscriptionDeps } from "@/server/payments";

const card = { authKey: z.string().min(1).max(300), customerKey: z.string().min(1).max(100) };

// 구독 (C-04 · M-03): 카드 등록 뒤 시작, 해지 예약 · 취소, 가격 인상 동의, 결제 수단 변경
export const POST = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  const viewer = await requireApiViewer(request);
  const subscriptionId = uuidParam((await params).id);
  const body = await parseBody(
    request,
    z.discriminatedUnion("action", [
      z.object({ action: z.literal("activate"), ...card }),
      z.object({ action: z.literal("cancel"), reason: z.string().trim().max(500).nullish() }),
      z.object({ action: z.literal("undo-cancel") }),
      z.object({ action: z.literal("agree-price") }),
      // 결제 수단 변경: 먼저 카드 등록창에 넘길 값을 받고(card-start), 돌아오면 card
      z.object({ action: z.literal("card-start") }),
      z.object({ action: z.literal("card"), ...card }),
    ]),
  );
  const deps = subscriptionDeps();
  const input = { userId: viewer.userId, subscriptionId };
  switch (body.action) {
    case "activate": {
      const sub = await activateSubscription(deps, {
        ...input,
        authKey: body.authKey,
        customerKey: body.customerKey,
      });
      return json({ status: sub.status, periodEnd: sub.currentPeriodEnd?.toISOString() ?? null });
    }
    case "cancel":
      return json({ status: (await scheduleCancel(deps, { ...input, reason: body.reason })).status });
    case "undo-cancel":
      return json({ status: (await undoCancel(deps, input)).status });
    case "agree-price":
      await agreePriceChange(deps, input);
      return json({ ok: true });
    case "card-start": {
      const [sub] = await deps.db
        .select({ customerKey: schema.subscriptions.customerKey })
        .from(schema.subscriptions)
        .where(
          and(eq(schema.subscriptions.id, subscriptionId), eq(schema.subscriptions.userId, viewer.userId)),
        );
      if (!sub) return json({ error: { code: "NOT_FOUND", message: "구독을 찾을 수 없습니다." } }, 404);
      const base = getEnv().BETTER_AUTH_URL.replace(/\/$/, "");
      return json({
        customerKey: sub.customerKey,
        clientKey: billingClientKey(),
        fake: fakeMode(),
        successUrl: `${base}/my/subscription/card/${subscriptionId}`,
        failUrl: `${base}/my/subscription?card=fail`,
      });
    }
    case "card":
      return json(await changeCard(deps, { ...input, authKey: body.authKey, customerKey: body.customerKey }));
  }
});
