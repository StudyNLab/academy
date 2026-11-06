import type { Metadata } from "next";
import Link from "next/link";
import { SvcIcon } from "@/components/icons";
import { SimpleMarkdown } from "@/components/simple-markdown";
import { getDb } from "@/server/db";
import { publishedFaqs } from "@/server/notices";

export const metadata: Metadata = { title: "자주 묻는 질문" };

type Search = Promise<Record<string, string | string[] | undefined>>;

// P-08 자주 묻는 질문 (시안 #/faq): 검색(질문 · 답에 낱말이 모두 있는 것) · 분류 탭 · 접고 펴기
export default async function FaqPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
  const q = one(params.q).slice(0, 100);
  const all = await publishedFaqs(getDb());
  const categories = [...new Set(all.map((row) => row.category))];
  const category = categories.includes(one(params.category)) ? one(params.category) : "";
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const rows = all.filter(
    (row) =>
      (!category || row.category === category) &&
      words.every((w) => `${row.question} ${row.answerMd}`.toLowerCase().includes(w)),
  );
  const href = (c: string) => {
    const p = new URLSearchParams();
    if (c) p.set("category", c);
    if (q) p.set("q", q);
    const text = p.toString();
    return text ? `/faq?${text}` : "/faq";
  };
  return (
    <div className="wrap page-main">
      <div className="breadcrumb">
        <Link href="/">홈</Link>
        <span>/</span>
        <span>자주 묻는 질문</span>
      </div>
      <div className="page-heading">
        <div>
          <span className="eyebrow">HELP CENTER</span>
          <h1>궁금한 점을 먼저 찾아보세요.</h1>
          <p>
            찾는 답이 없으면 1:1 문의로 알려 주세요. 강의 내용은 학습 화면의 Q&amp;A 에서 물어볼 수 있습니다.
          </p>
        </div>
      </div>
      <form className="help-search" action="/faq" role="search">
        {category ? <input type="hidden" name="category" value={category} /> : null}
        <label className="sr-only" htmlFor="faq-search">
          도움말 검색
        </label>
        <input
          className="field"
          id="faq-search"
          name="q"
          type="search"
          placeholder="예: 환불, 구독 해지, API 요금"
          defaultValue={q}
          maxLength={100}
        />
        <button className="btn primary">검색</button>
      </form>
      {categories.length > 1 ? (
        <nav className="segmented section-space" aria-label="질문 분류">
          {["", ...categories].map((c) => (
            <Link
              key={c || "all"}
              href={href(c)}
              className={c === category ? "active" : ""}
              aria-current={c === category ? "page" : undefined}
            >
              {c || "전체"}
            </Link>
          ))}
        </nav>
      ) : null}
      {rows.length === 0 ? (
        <p className={`surface padded text-muted ${categories.length > 1 ? "" : "mt-6"}`}>
          {all.length === 0 ? "아직 준비 중입니다." : "찾는 질문이 없습니다. 다른 낱말로 찾아보세요."}
        </p>
      ) : (
        <section className={`surface faq-list ${categories.length > 1 ? "" : "mt-6"}`}>
          {rows.map((faq) => (
            <details key={faq.id} className="faq-item">
              <summary>{faq.question}</summary>
              <SimpleMarkdown source={faq.answerMd} />
            </details>
          ))}
        </section>
      )}
      <div className="wide-callout">
        <div>
          <h2>아직 해결되지 않았나요?</h2>
          <p>확인에 필요한 내용을 남겨 주시면 도와드리겠습니다.</p>
        </div>
        <Link className="btn secondary" href="/my/inquiries/new">
          1:1 문의 <SvcIcon name="arrow" />
        </Link>
      </div>
    </div>
  );
}
