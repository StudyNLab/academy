import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusDot } from "@aionit/ui";
import { INQUIRY_STATUS } from "@/components/inquiry-labels";
import { InquiryThread } from "@/components/inquiry-thread";
import { PageTitle } from "@/components/page-title";
import { getDb } from "@/server/db";
import { inquiryForMember } from "@/server/inquiries";
import { requireViewer } from "@/server/session";
import { SupportError } from "@/server/support-error";
import { InquiryReply } from "../inquiry-forms";

export const metadata: Metadata = { title: "1:1 문의" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// M-05 내 문의 하나: 글 · 운영자 답변, 이어서 쓰기, 닫기
export default async function InquiryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireViewer(`/my/inquiries/${id}`);
  if (!UUID.test(id)) notFound();
  const found = await inquiryForMember(getDb(), viewer, id).catch((error: unknown) => {
    if (error instanceof SupportError) return null;
    throw error;
  });
  if (!found) notFound();
  const { inquiry, messages } = found;
  const [label, tone] = INQUIRY_STATUS[inquiry.status];
  return (
    <>
      <PageTitle label={inquiry.category} title={inquiry.title}>
        <span className="flex flex-wrap items-center gap-4">
          <StatusDot tone={tone}>{label}</StatusDot>
          <Link href="/my/inquiries">← 목록</Link>
        </span>
      </PageTitle>
      <InquiryThread messages={messages} memberLabel="나" />
      {inquiry.status === "closed" ? (
        <p className="mt-8 border-t border-line-strong pt-6 text-[14px] text-ink-2">
          끝난 문의입니다. 더 궁금한 점은 <Link href="/my/inquiries/new">새 문의</Link>로 남겨 주세요.
        </p>
      ) : (
        <div className="mt-8">
          <InquiryReply id={inquiry.id} canClose />
        </div>
      )}
    </>
  );
}
