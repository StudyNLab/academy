import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusDot } from "@aionit/ui";
import { formatDayTime } from "@/components/commerce/format";
import { INQUIRY_STATUS } from "@/components/inquiry-labels";
import { InquiryThread } from "@/components/inquiry-thread";
import { PageTitle } from "@/components/page-title";
import { getDb } from "@/server/db";
import { inquiryForAdmin } from "@/server/inquiries";
import { requireStaff } from "@/server/session";
import { SupportError } from "@/server/support-error";
import { AdminInquiryReply } from "./reply-form";

export const metadata: Metadata = { title: "1:1 문의" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// AD-13 문의 하나: 글 · 답변 쓰기 · 닫기. 열어 보면 개인정보 조회 기록에 남는다
export default async function AdminInquiry({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireStaff("operator", `/admin/inquiries/${id}`);
  if (!UUID.test(id)) notFound();
  const found = await inquiryForAdmin(getDb(), { userId: viewer.userId, headers: await headers() }, id).catch(
    (error: unknown) => {
      if (error instanceof SupportError) return null;
      throw error;
    },
  );
  if (!found) notFound();
  const { inquiry, member, messages } = found;
  const [label, tone] = INQUIRY_STATUS[inquiry.status];
  const memberLabel = member?.nickname ?? "탈퇴한 회원";
  return (
    <>
      <PageTitle label={inquiry.category} title={inquiry.title}>
        <span className="flex flex-wrap items-center gap-4 text-[14px]">
          <StatusDot tone={tone}>{label}</StatusDot>
          <span>
            <Link href={`/admin/users/${inquiry.userId}`}>{memberLabel}</Link> ·{" "}
            {formatDayTime(inquiry.createdAt)}
          </span>
          <Link href="/admin/inquiries">← 목록</Link>
        </span>
      </PageTitle>
      <InquiryThread messages={messages} memberLabel={memberLabel} />
      {inquiry.status === "closed" ? (
        <p className="mt-8 border-t border-line-strong pt-6 text-[14px] text-ink-2">끝난 문의입니다.</p>
      ) : (
        <div className="mt-8">
          <AdminInquiryReply id={inquiry.id} />
        </div>
      )}
    </>
  );
}
