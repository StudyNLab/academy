import { json, requireApiViewer, route, uuidParam } from "@/server/api";
import { agreeToOrder } from "@/server/commerce";
import { getDb } from "@/server/db";
import { getEnv } from "@/server/env";
import { clientIp } from "@/server/records";

// 주문서의 동의 체크 ➔ 동의를 기록하고 토스 결제창에 넘길 값을 준다 (금액은 주문 스냅샷)
export const POST = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  const viewer = await requireApiViewer(request);
  const env = getEnv();
  return json(
    await agreeToOrder(getDb(), viewer, uuidParam((await params).id), {
      baseUrl: env.BETTER_AUTH_URL.replace(/\/$/, ""),
      ip: clientIp(request.headers),
    }),
  );
});
