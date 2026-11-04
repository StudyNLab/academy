import type { Metadata } from "next";
import Link from "next/link";
import { LinkButton, MonoLabel, StatusDot } from "@aionit/ui";
import { formatDayTime } from "@/components/commerce/format";
import { INQUIRY_STATUS } from "@/components/inquiry-labels";
import { PageTitle } from "@/components/page-title";
import { getDb } from "@/server/db";
import { myInquiries } from "@/server/inquiries";
import { requireViewer } from "@/server/session";

export const metadata: Metadata = { title: "1:1 문의" };

// M-05 1:1 문의: 내 문의 목록 + 새 문의
export default async function InquiriesPage() {
  const viewer = await requireViewer("/my/inquiries");
  const rows = await myInquiries(getDb(), viewer.userId);
  return (
    <>
      <PageTitle label="Inquiries" title="1:1 문의">
        결제 · 환불 · 계정처럼 나만의 일은 여기에 남겨 주세요. 운영자가 답하면 알림과 메일로 알려 드립니다.
        강의 내용 질문은 학습 화면의 Q&amp;A 가 더 빠릅니다. <Link href="/faq">자주 묻는 질문</Link>도 먼저
        확인해 보세요.
      </PageTitle>
      <LinkButton href="/my/inquiries/new" className="mb-8">
        문의하기
      </LinkButton>
      {rows.length === 0 ? (
        <p className="m-0 border-t border-line-strong pt-6 text-ink-2">남긴 문의가 없습니다.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col border-t border-line-strong p-0">
          {rows.map((inquiry) => {
            const [label, tone] = INQUIRY_STATUS[inquiry.status];
            return (
              <li key={inquiry.id} className="border-b border-line">
                <Link
                  href={`/my/inquiries/${inquiry.id}`}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-4 text-ink no-underline"
                >
                  <span className="flex min-w-0 flex-col gap-1">
                    <MonoLabel className="text-[11px] text-ink-2">
                      {inquiry.category} · {formatDayTime(inquiry.createdAt)}
                    </MonoLabel>
                    <span className="text-[16px] font-semibold">{inquiry.title}</span>
                  </span>
                  <StatusDot tone={tone}>{label}</StatusDot>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
