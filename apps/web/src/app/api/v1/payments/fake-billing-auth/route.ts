import { z } from "zod";
import { tossCustomerKey } from "@aionit/payments";
import { ApiError, json, parseBody, requireApiViewer, route } from "@/server/api";
import { getEnv } from "@/server/env";
import { fakeToss } from "@/server/payments";

// 개발 서버 가짜 카드 등록창 (TOSS_FAKE=1 일 때만, 운영 빌드에서는 404): 카드 등록을 마친 것처럼 authKey 를 만든다.
// 빌링키 발급 · 결제는 진짜와 같이 /subscriptions/{id} 로
export const POST = route(async (request) => {
  const fake = fakeToss();
  const viewer = await requireApiViewer(request);
  const body = await parseBody(request, z.object({ customerKey: z.string().max(100) }));
  if (body.customerKey !== tossCustomerKey(getEnv().BETTER_AUTH_SECRET, viewer.userId))
    throw new ApiError(400, "CUSTOMER_MISMATCH", "고객 키가 다릅니다.");
  return json({ authKey: fake.authorizeBilling(body.customerKey) });
});
