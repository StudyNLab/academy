import type { Metadata } from "next";
import { requireViewer } from "@/server/session";
import { ActivateSubscription } from "./activate";

export const metadata: Metadata = { title: "구독 시작" };

// 카드 등록창에서 돌아옴 (customerKey · authKey) ➔ 화면이 API 로 빌링키 발급 · 첫 결제를 요청한다
export default async function SubscribeSuccess({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  await requireViewer("/subscribe");
  return (
    <ActivateSubscription
      subscriptionId={id}
      authKey={query.authKey ?? ""}
      customerKey={query.customerKey ?? ""}
    />
  );
}
