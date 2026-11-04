import type { Metadata } from "next";
import Link from "next/link";
import { PageTitle } from "@/components/page-title";
import { dashboardCounts } from "@/server/admin-queries";
import { getDb } from "@/server/db";
import { requireStaff } from "@/server/session";

export const metadata: Metadata = { title: "관리자" };

// AD-01 대시보드 (M1 회원, M5 매출 · 환불 요청, M6 구독, M7 문의 · 신고 · 미답변 질문. 검수는 M8)
export default async function AdminHome() {
  await requireStaff("operator", "/admin");
  const counts = await dashboardCounts(getDb());
  const tiles = [
    { label: "전체 회원", value: counts.total },
    { label: "오늘 가입", value: counts.today },
    { label: "운영자 · 강사", value: counts.staff },
    { label: "로그인 실패 (24시간)", value: counts.failures },
    { label: "오늘 결제 (원)", value: counts.sales.toLocaleString("ko-KR") },
    { label: "구독 중", value: counts.subscribers, href: "/admin/subscriptions" },
    { label: "환불 요청 대기", value: counts.refunds, href: "/admin/refunds" },
    { label: "답변 기다리는 문의", value: counts.inquiries, href: "/admin/inquiries" },
    { label: "신고된 글", value: counts.reports, href: "/admin/qna" },
    { label: "3일 넘은 미답변 질문", value: counts.stale, href: "/admin/qna" },
  ];
  return (
    <>
      <PageTitle label="Dashboard" title="대시보드" />
      <dl className="m-0 grid grid-cols-2 border-t border-line-strong md:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.label} className="flex flex-col gap-1 border-b border-line py-5 pr-4">
            <dt className="text-[13px] text-ink-2">{tile.label}</dt>
            <dd className="m-0 text-[32px] font-semibold tabular-nums tracking-[-0.03em]">
              {"href" in tile && tile.href ? (
                <Link href={tile.href} className="text-ink no-underline">
                  {tile.value}
                </Link>
              ) : (
                tile.value
              )}
            </dd>
          </div>
        ))}
      </dl>
    </>
  );
}
