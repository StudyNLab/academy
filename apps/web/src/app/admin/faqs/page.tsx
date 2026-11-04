import type { Metadata } from "next";
import Link from "next/link";
import { PageTitle } from "@/components/page-title";
import { getDb } from "@/server/db";
import { allFaqs } from "@/server/notices";
import { requireStaff } from "@/server/session";
import { FaqForm } from "../notices/notice-forms";

export const metadata: Metadata = { title: "자주 묻는 질문" };

// AD-12 자주 묻는 질문: 분류 ➔ 순서대로. 누르면 펼쳐서 고친다
export default async function AdminFaqs() {
  await requireStaff("operator", "/admin/faqs");
  const rows = await allFaqs(getDb());
  return (
    <>
      <PageTitle label="FAQ" title="자주 묻는 질문">
        <Link href="/faq">사이트에서 보기</Link> · <Link href="/admin/notices">← 공지</Link>
      </PageTitle>
      <div className="mb-12 border-t border-line-strong">
        {rows.map((faq) => (
          <details key={faq.id} className="border-b border-line">
            <summary className="flex min-h-12 cursor-pointer items-baseline gap-3 py-3 text-[15px]">
              <span className="text-[13px] text-ink-2">
                {faq.category} · {faq.sortOrder}
              </span>
              <strong className="font-semibold">{faq.question}</strong>
              {faq.published ? null : <span className="text-[13px] text-ink-2">(숨김)</span>}
            </summary>
            <div className="pb-6">
              <FaqForm faq={faq} />
            </div>
          </details>
        ))}
        {rows.length === 0 ? <p className="m-0 py-5 text-ink-2">아직 없습니다.</p> : null}
      </div>
      <section aria-label="질문 더하기" className="max-w-[760px]">
        <h2 className="m-0 mb-5 text-[21px] font-semibold tracking-[-0.02em]">질문 더하기</h2>
        <FaqForm />
      </section>
    </>
  );
}
