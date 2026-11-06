import type { Metadata } from "next";
import Link from "next/link";
import { SvcIcon } from "@/components/icons";
import { PageTitle } from "@/components/page-title";
import { dashboardCounts } from "@/server/admin-queries";
import { getDb } from "@/server/db";
import { requireStaff } from "@/server/session";

export const metadata: Metadata = { title: "관리자" };

// AD-01 대시보드 (M1 회원, M5 매출 · 환불 요청, M6 구독, M7 문의 · 신고 · 미답변 질문, M8 검수 대기)
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
    { label: "검수 대기", value: counts.reviews, href: "/admin/reviews" },
  ];
  return (
    <>
      <PageTitle label="Operations" title="운영 대시보드">
        <p className="m-0">확인이 필요한 업무부터 처리하세요. 숫자를 누르면 그 화면으로 갑니다.</p>
      </PageTitle>
      <div className="metric-grid">
        {tiles.map((tile) => (
          <div key={tile.label} className="surface metric">
            <span>{tile.label}</span>
            <strong className="tabular-nums">
              {"href" in tile && tile.href ? (
                <Link href={tile.href} className="text-ink no-underline">
                  {tile.value}
                </Link>
              ) : (
                tile.value
              )}
            </strong>
          </div>
        ))}
      </div>
      <div className="wide-callout">
        <div>
          <h2>업무를 안전하게 마무리하세요.</h2>
          <p>돈과 권한을 바꾸는 작업에는 사유가 필요하고, 모두 기록에 남습니다.</p>
        </div>
        <Link className="btn secondary" href="/admin/reviews">
          검수 업무로 <SvcIcon name="arrow" />
        </Link>
      </div>
    </>
  );
}
