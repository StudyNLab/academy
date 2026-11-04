import type { Metadata } from "next";
import Link from "next/link";
import { MonoLabel } from "@aionit/ui";
import { PageTitle } from "@/components/page-title";
import { SimpleMarkdown } from "@/components/simple-markdown";
import { getDb } from "@/server/db";
import { publishedFaqs } from "@/server/notices";

export const metadata: Metadata = { title: "자주 묻는 질문" };

// P-08 자주 묻는 질문: 분류별로 접고 펴기
export default async function FaqPage() {
  const rows = await publishedFaqs(getDb());
  const groups = new Map<string, typeof rows>();
  for (const row of rows) groups.set(row.category, [...(groups.get(row.category) ?? []), row]);
  return (
    <div className="mx-auto max-w-[760px] px-5 pt-16 md:px-0">
      <PageTitle label="FAQ" title="자주 묻는 질문">
        찾는 답이 없으면 <Link href="/my/inquiries/new">1:1 문의</Link>로 알려 주세요. 강의 내용은 학습 화면의
        Q&amp;A 에서 물어볼 수 있습니다.
      </PageTitle>
      {rows.length === 0 ? (
        <p className="m-0 border-t border-line-strong pt-6 text-ink-2">아직 준비 중입니다.</p>
      ) : (
        <div className="flex flex-col gap-10">
          {[...groups].map(([category, items]) => (
            <section key={category} aria-label={category} className="flex flex-col">
              <MonoLabel className="mb-3 text-xs text-signal">{category}</MonoLabel>
              <div className="border-t border-line-strong">
                {items.map((faq) => (
                  <details key={faq.id} className="group border-b border-line">
                    <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 py-3 text-[16px] font-semibold">
                      <span>{faq.question}</span>
                      <span aria-hidden="true" className="text-ink-2 group-open:rotate-45">
                        +
                      </span>
                    </summary>
                    <div className="pb-5 text-ink-2">
                      <SimpleMarkdown source={faq.answerMd} />
                    </div>
                  </details>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
