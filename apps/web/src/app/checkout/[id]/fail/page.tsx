import Link from "next/link";
import { Notice } from "@aionit/ui";
import { SvcIcon } from "@/components/icons";
import { ResultPage } from "@/components/result-page";
import { requireViewer } from "@/server/session";

// C-03 결제 실패 · 취소: 토스가 code · message 를 붙여 돌려보낸다. 주문서는 그대로 남아 다시 결제할 수 있다
export default async function CheckoutFail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  await requireViewer(`/checkout/${id}`);
  const canceled = query.code === "PAY_PROCESS_CANCELED" || query.code === "USER_CANCEL";
  return (
    <ResultPage
      eyebrow="PAYMENT RESULT"
      title={canceled ? "결제를 취소했습니다" : "결제하지 못했습니다"}
      desc={
        canceled
          ? "돈은 나가지 않았습니다. 주문서에서 다시 결제할 수 있습니다."
          : "다시 시도하기 전에 아래 내용을 확인해 주세요."
      }
      mark="fail"
      body={
        canceled ? undefined : (
          <Notice tone="danger">{(query.message ?? "알 수 없는 오류입니다.").slice(0, 200)}</Notice>
        )
      }
      actions={
        <>
          <Link href={`/checkout/${encodeURIComponent(id)}`} className="btn primary">
            다시 결제 <SvcIcon name="arrow" />
          </Link>
          <Link href="/courses" className="btn secondary">
            강의 목록
          </Link>
        </>
      }
    />
  );
}
