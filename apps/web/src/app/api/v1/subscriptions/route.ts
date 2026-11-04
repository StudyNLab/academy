import { z } from "zod";
import { startSubscription } from "@aionit/payments";
import { ApiError, json, parseBody, requireApiViewer, route } from "@/server/api";
import { currentPolicies } from "@/server/consents";
import { getDb } from "@/server/db";
import { getEnv } from "@/server/env";
import { billingClientKey, billingEnabled, fakeMode } from "@/server/payments";
import { clientIp } from "@/server/records";

// C-04 구독 신청: 자동결제 동의 · 약관 동의를 따로 받아 신청을 만들고, 카드 등록창에 넘길 값을 준다
export const POST = route(async (request) => {
  const viewer = await requireApiViewer(request);
  if (!billingEnabled()) throw new ApiError(503, "BILLING_DISABLED", "구독 신청을 준비하고 있습니다.");
  const body = await parseBody(
    request,
    z.object({
      productId: z.uuid({ error: "요금제를 골라 주세요." }),
      autoRenewAgreed: z.literal(true, { error: "정기결제(자동결제)에 동의해 주세요." }),
      termsAgreed: z.literal(true, { error: "구독 이용약관 · 환불 규정에 동의해 주세요." }),
    }),
  );
  const db = getDb();
  const env = getEnv();
  const refund = (await currentPolicies(db, ["refund"])).get("refund");
  const sub = await startSubscription(
    { db, secret: env.BETTER_AUTH_SECRET },
    {
      userId: viewer.userId,
      ...body,
      refundPolicyDocumentId: refund?.id ?? null,
      ip: clientIp(request.headers),
    },
  );
  const base = env.BETTER_AUTH_URL.replace(/\/$/, "");
  return json({
    subscriptionId: sub.id,
    customerKey: sub.customerKey,
    clientKey: billingClientKey(),
    fake: fakeMode(),
    successUrl: `${base}/subscribe/${sub.id}/success`,
    failUrl: `${base}/subscribe/${sub.id}/fail`,
  });
});
