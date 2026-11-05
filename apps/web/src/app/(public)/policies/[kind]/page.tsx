import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Notice } from "@aionit/ui";
import { PageTitle } from "@/components/page-title";
import { SimpleMarkdown } from "@/components/simple-markdown";
import { getDb } from "@/server/db";
import { isPolicyKind, POLICY_LABELS, policyHistory } from "@/server/policies";

type Params = Promise<{ kind: string }>;
type Search = Promise<{ v?: string | string[] }>;

async function load(kind: string, version?: string) {
  if (!isPolicyKind(kind)) return null;
  const history = await policyHistory(getDb(), kind);
  // 아직 시행 중인 버전이 없는 새 종류(예: 처음 올린 개인정보처리방침)는 시행 예정 버전을 보여 준다
  const doc = version
    ? history.find((h) => h.version === version)
    : (history.find((h) => h.state === "current") ?? history.at(-1));
  if (!doc) return null;
  return { kind, doc, history };
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { kind } = await params;
  return { title: isPolicyKind(kind) ? POLICY_LABELS[kind] : "정책 문서" };
}

const date = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium" });

// P-09 정책 문서: 지금 시행 중인 버전 + 시행 예정 버전 안내 + 지난 버전 목록 (?v=버전 으로 그 버전)
export default async function PolicyPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { kind } = await params;
  const { v } = await searchParams;
  const data = await load(kind, typeof v === "string" ? v : undefined);
  if (!data) notFound();
  const { doc, history } = data;
  const scheduled = history.filter((h) => h.state === "scheduled").at(-1);
  return (
    <article className="mx-auto max-w-[760px] px-5 pt-16 md:px-0">
      <PageTitle label={`Policy · ${doc.version}`} title={doc.title}>
        <p className="m-0 text-[14px]">시행일 {date.format(doc.effectiveFrom)}</p>
      </PageTitle>
      {doc.state === "past" ? (
        <div className="mb-8">
          <Notice tone="warn">
            지난 버전입니다. <Link href={`/policies/${kind}`}>지금 시행 중인 버전 보기</Link>
          </Notice>
        </div>
      ) : null}
      {doc.state === "scheduled" ? (
        <div className="mb-8">
          <Notice tone="warn">
            {date.format(doc.effectiveFrom)} 부터 시행할 버전입니다. 그때까지는{" "}
            <Link href={`/policies/${kind}`}>지금 버전</Link>이 적용됩니다.
          </Notice>
        </div>
      ) : null}
      {doc.state === "current" && scheduled ? (
        <div className="mb-8">
          <Notice tone="warn">
            {date.format(scheduled.effectiveFrom)} 부터 바뀝니다.{" "}
            <Link href={`/policies/${kind}?v=${encodeURIComponent(scheduled.version)}`}>바뀔 버전 보기</Link>
          </Notice>
        </div>
      ) : null}
      <SimpleMarkdown source={doc.bodyMd} />
      {history.length > 1 ? (
        <section className="mt-14 border-t border-line-strong pt-6">
          <h2 className="m-0 mb-4 text-[17px] font-semibold">모든 버전</h2>
          <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[14px]">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap gap-x-3">
                {h.id === doc.id ? (
                  <strong>{h.version}</strong>
                ) : (
                  <Link href={`/policies/${kind}?v=${encodeURIComponent(h.version)}`}>{h.version}</Link>
                )}
                <span className="text-ink-2">
                  {date.format(h.effectiveFrom)} 시행
                  {h.state === "current" ? " · 지금 버전" : h.state === "scheduled" ? " · 시행 예정" : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}
