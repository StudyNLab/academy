import Link from "next/link";
import { buttonClass, MonoLabel, Notice } from "@aionit/ui";

// 카드 등록 실패 · 취소 (토스가 code · message 를 붙여 돌려보낸다). 돈은 나가지 않았다
export default async function SubscribeFail({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const query = await searchParams;
  const canceled = query.code === "PAY_PROCESS_CANCELED" || query.code === "USER_CANCEL";
  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-5 px-5 pt-16 pb-16 md:px-0">
      <MonoLabel className="text-xs text-danger">{canceled ? "Canceled" : "Failed"}</MonoLabel>
      <h1 className="m-0 text-[32px] font-semibold tracking-[-0.035em]">
        {canceled ? "카드 등록을 취소했습니다" : "카드를 등록하지 못했습니다"}
      </h1>
      {canceled ? (
        <p className="m-0 text-ink-2">돈은 나가지 않았습니다. 다시 신청할 수 있습니다.</p>
      ) : (
        <Notice tone="danger">{(query.message ?? "알 수 없는 오류입니다.").slice(0, 200)}</Notice>
      )}
      <Link href="/subscribe" className={buttonClass("primary", "md", "self-start")}>
        다시 신청
      </Link>
    </div>
  );
}
