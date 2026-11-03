import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { PolicyKind } from "@aionit/db";
import { POLICY_KINDS } from "@aionit/db";
import { PageTitle } from "@/components/page-title";
import { SimpleMarkdown } from "@/components/simple-markdown";
import { currentPolicies } from "@/server/consents";
import { getDb } from "@/server/db";

type Params = Promise<{ kind: string }>;

async function load(kind: string) {
  if (!(POLICY_KINDS as readonly string[]).includes(kind)) return null;
  return (await currentPolicies(getDb(), [kind as PolicyKind])).get(kind as PolicyKind) ?? null;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const doc = await load((await params).kind);
  return { title: doc?.title ?? "정책 문서" };
}

const date = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium" });

// P-09 정책 문서: 지금 시행 중인 버전. (지난 버전 목록은 실오픈 때 정책 문서를 확정하며 더한다, M10)
export default async function PolicyPage({ params }: { params: Params }) {
  const doc = await load((await params).kind);
  if (!doc) notFound();
  return (
    <article className="mx-auto max-w-[760px] px-5 pt-16 md:px-0">
      <PageTitle label={`Policy · ${doc.version}`} title={doc.title}>
        <p className="m-0 text-[14px]">시행일 {date.format(doc.effectiveFrom)}</p>
      </PageTitle>
      <SimpleMarkdown source={doc.bodyMd} />
    </article>
  );
}
