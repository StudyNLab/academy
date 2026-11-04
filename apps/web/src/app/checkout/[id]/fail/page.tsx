import Link from "next/link";
import { buttonClass, MonoLabel, Notice } from "@aionit/ui";
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
    <div className="flex flex-col gap-5">
      <MonoLabel className="text-xs text-danger">{canceled ? "Canceled" : "Payment failed"}</MonoLabel>
      <h1 className="m-0 text-[32px] font-semibold tracking-[-0.035em]">
        {canceled ? "결제를 취소했습니다" : "결제하지 못했습니다"}
      </h1>
      {!canceled ? (
        <Notice tone="danger">{(query.message ?? "알 수 없는 오류입니다.").slice(0, 200)}</Notice>
      ) : (
        <p className="m-0 text-ink-2">돈은 나가지 않았습니다. 주문서에서 다시 결제할 수 있습니다.</p>
      )}
      <div className="flex flex-wrap gap-4">
        <Link href={`/checkout/${encodeURIComponent(id)}`} className={buttonClass("primary", "md")}>
          다시 결제
        </Link>
        <Link href="/courses" className={buttonClass("outline", "md")}>
          강의 목록
        </Link>
      </div>
    </div>
  );
}
