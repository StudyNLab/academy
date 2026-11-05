import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { kstDate } from "@aionit/core";
import { StatusDot } from "@aionit/ui";
import { PageTitle } from "@/components/page-title";
import { dotDate, Section, Table } from "@/components/settlement-view";
import { getDb } from "@/server/db";
import { earliestEffectiveOn, isPolicyKind, POLICY_LABELS, policyHistory } from "@/server/policies";
import type { PolicyState } from "@/server/policies";
import { requireStaff } from "@/server/session";
import { DeletePolicyButton, PolicyVersionForm } from "../policy-forms";

export const metadata: Metadata = { title: "정책 문서 버전" };

const STATE_DOT: Record<PolicyState, { tone: "done" | "warn" | "muted"; label: string }> = {
  current: { tone: "done", label: "시행 중" },
  scheduled: { tone: "warn", label: "시행 예정" },
  past: { tone: "muted", label: "지난 버전" },
};

// AD-12 정책 문서 한 종류: 모든 버전(시행일 · 상태), 새 버전 게시, 시행 전 버전 지우기
export default async function AdminPolicyKind({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!isPolicyKind(kind)) notFound();
  await requireStaff("operator", `/admin/policies/${kind}`);
  const now = new Date();
  const history = await policyHistory(getDb(), kind, now);
  const latest = history[0];
  return (
    <>
      <PageTitle label="Policy versions" title={POLICY_LABELS[kind]}>
        <p className="m-0">
          <Link href="/admin/policies">← 정책 문서</Link> ·{" "}
          <Link href={`/policies/${kind}`}>공개 화면 보기</Link>
        </p>
      </PageTitle>
      <Table
        empty="아직 버전이 없습니다."
        left={3}
        head={["시행일", "버전", "제목", ""]}
        rows={history.map((row) => [
          <span key="d" className="flex flex-col gap-1">
            <span className="tabular-nums">{dotDate(kstDate(row.effectiveFrom))}</span>
            <StatusDot tone={STATE_DOT[row.state].tone}>{STATE_DOT[row.state].label}</StatusDot>
          </span>,
          <Link
            key="v"
            href={`/policies/${kind}?v=${encodeURIComponent(row.version)}`}
            className="tabular-nums"
          >
            {row.version}
          </Link>,
          row.title,
          row.state === "scheduled" ? <DeletePolicyButton key="x" id={row.id} version={row.version} /> : "",
        ])}
      />
      <Section title="새 버전">
        <p className="mt-0 mb-5 text-[14px] text-ink-2">
          가장 최근 버전의 내용을 불러왔습니다. 고친 뒤 버전 이름과 시행일을 정해 게시합니다. 바뀌는 내용은
          공지(<Link href="/admin/notices">공지 관리</Link>)로도 알려 주세요.
        </p>
        <PolicyVersionForm
          kind={kind}
          title={latest?.title ?? POLICY_LABELS[kind]}
          bodyMd={latest?.bodyMd ?? ""}
          earliest={earliestEffectiveOn(kind, false, now)}
          earliestAdverse={earliestEffectiveOn(kind, true, now)}
        />
      </Section>
    </>
  );
}
