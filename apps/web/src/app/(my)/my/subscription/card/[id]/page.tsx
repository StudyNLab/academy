import type { Metadata } from "next";
import { requireViewer } from "@/server/session";
import { ConfirmCard } from "./confirm-card";

export const metadata: Metadata = { title: "결제 수단 변경" };

// 결제 수단 변경: 카드 등록창에서 돌아옴 (customerKey · authKey) ➔ 새 빌링키로 바꾼다 (결제 실패 중이면 바로 다시 결제)
export default async function CardChanged({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  await requireViewer("/my/subscription");
  return (
    <ConfirmCard subscriptionId={id} authKey={query.authKey ?? ""} customerKey={query.customerKey ?? ""} />
  );
}
