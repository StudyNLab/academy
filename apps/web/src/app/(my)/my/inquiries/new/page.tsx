import type { Metadata } from "next";
import Link from "next/link";
import { INQUIRY_CATEGORIES } from "@aionit/core";
import { PageTitle } from "@/components/page-title";
import { requireViewer } from "@/server/session";
import { InquiryForm } from "../inquiry-forms";

export const metadata: Metadata = { title: "문의하기" };

// M-05 문의 쓰기. ?category= 로 종류를 미리 고를 수 있다 (환불 불가 안내 등에서 온 경우)
export default async function NewInquiryPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  await requireViewer("/my/inquiries/new");
  const { category } = await searchParams;
  const initial = INQUIRY_CATEGORIES.find((c) => c === category) ?? "";
  return (
    <>
      <PageTitle label="New inquiry" title="문의하기">
        운영자만 봅니다. 비밀번호 · 카드 번호 같은 정보는 적지 마세요.{" "}
        <Link href="/my/inquiries">← 목록</Link>
      </PageTitle>
      <InquiryForm categories={[...INQUIRY_CATEGORIES]} initialCategory={initial} />
    </>
  );
}
