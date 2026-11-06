import type { Metadata } from "next";
import Link from "next/link";
import { Notice } from "@aionit/ui";
import { SvcIcon } from "@/components/icons";
import { ResultPage } from "@/components/result-page";

export const metadata: Metadata = { title: "카드 등록 실패" };

// 카드 등록 실패 · 취소 (토스가 code · message 를 붙여 돌려보낸다). 돈은 나가지 않았다
export default async function SubscribeFail({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const query = await searchParams;
  const canceled = query.code === "PAY_PROCESS_CANCELED" || query.code === "USER_CANCEL";
  return (
    <ResultPage
      eyebrow="SUBSCRIPTION RESULT"
      title={canceled ? "카드 등록을 취소했습니다" : "카드를 등록하지 못했습니다"}
      desc="돈은 나가지 않았습니다. 다시 신청할 수 있습니다."
      mark="fail"
      body={
        canceled ? undefined : (
          <Notice tone="danger">{(query.message ?? "알 수 없는 오류입니다.").slice(0, 200)}</Notice>
        )
      }
      actions={
        <Link href="/subscribe" className="btn primary">
          다시 신청 <SvcIcon name="arrow" />
        </Link>
      }
    />
  );
}
