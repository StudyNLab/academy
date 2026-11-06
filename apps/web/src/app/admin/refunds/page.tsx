import type { Metadata } from "next";
import Link from "next/link";
import { StatusDot } from "@aionit/ui";
import { formatDayTime, won } from "@/components/commerce/format";
import { PageTitle } from "@/components/page-title";
import { getDb } from "@/server/db";
import { adminRefunds } from "@/server/refunds";
import { requireStaff } from "@/server/session";
import { REFUND_STATUS } from "../labels";

export const metadata: Metadata = { title: "환불" };

// AD-10 환불 처리: 요청 목록 (오래 기다린 순)
export default async function AdminRefunds({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  await requireStaff("operator", "/admin/refunds");
  const all = (await searchParams).all === "1";
  const rows = await adminRefunds(getDb(), all ? "all" : "open");
  return (
    <>
      <PageTitle label="Refunds" title="환불">
        {all ? "모든 환불 기록 (최근 200건)" : "처리를 기다리는 요청"} ·{" "}
        <Link href={all ? "/admin/refunds" : "/admin/refunds?all=1"}>
          {all ? "기다리는 것만" : "전체 보기"}
        </Link>
      </PageTitle>
      <ul className="surface m-0 flex list-none flex-col overflow-hidden p-0 [&>li]:px-6 text-[15px]">
        {rows.map(({ refund, item, nickname }) => {
          const [label, tone] = REFUND_STATUS[refund.status];
          return (
            <li key={refund.id} className="border-b border-line py-4">
              <Link
                href={`/admin/refunds/${refund.id}`}
                className="flex flex-wrap items-baseline justify-between gap-3 text-ink no-underline"
              >
                <span>
                  <strong className="font-semibold">{item.productName}</strong>
                  <span className="text-ink-2">
                    {" "}
                    · {nickname ?? "(탈퇴한 회원)"} · {formatDayTime(refund.createdAt)} · {refund.reason}
                  </span>
                </span>
                <span className="flex items-baseline gap-3">
                  <span className="tabular-nums">{won(refund.approvedAmount ?? refund.requestedAmount)}</span>
                  <StatusDot tone={tone}>{label}</StatusDot>
                </span>
              </Link>
              {refund.failMessage ? (
                <p className="m-0 mt-1 text-[13px] text-danger">토스 취소 실패: {refund.failMessage}</p>
              ) : null}
            </li>
          );
        })}
        {rows.length === 0 ? <li className="py-5 text-ink-2">없음</li> : null}
      </ul>
    </>
  );
}
