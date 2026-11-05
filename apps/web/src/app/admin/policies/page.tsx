import type { Metadata } from "next";
import Link from "next/link";
import { kstDate } from "@aionit/core";
import { StatusDot } from "@aionit/ui";
import { PageTitle } from "@/components/page-title";
import { dotDate, Table } from "@/components/settlement-view";
import { getDb } from "@/server/db";
import { policyOverview } from "@/server/policies";
import { requireStaff } from "@/server/session";

export const metadata: Metadata = { title: "정책 문서" };

// AD-12 정책 문서: 종류마다 지금 시행 중인 버전 · 시행 예정 버전. 새 버전은 종류 화면에서
export default async function AdminPolicies() {
  await requireStaff("operator", "/admin/policies");
  const rows = await policyOverview(getDb());
  return (
    <>
      <PageTitle label="Policies" title="정책 문서">
        <p className="m-0">
          약관 · 개인정보 · 환불 정책은 고치지 않고 새 버전을 시행일과 함께 올립니다. 시행일 전에는 지금
          버전이 그대로 쓰이고, 정책 화면에 시행 예정 버전과 지난 버전이 함께 보입니다. 법률 검토용 초안은{" "}
          <code>docs/정책초안/</code>.
        </p>
      </PageTitle>
      <Table
        empty="정책 문서가 없습니다."
        left={4}
        head={["문서", "시행 중", "시행 예정", "버전 수"]}
        rows={rows.map((r) => [
          <Link key="k" href={`/admin/policies/${r.kind}`} className="font-semibold text-ink">
            {r.label}
          </Link>,
          r.current ? (
            <span key="c" className="tabular-nums">
              {r.current.version} · {dotDate(kstDate(r.current.effectiveFrom))}
            </span>
          ) : (
            <StatusDot key="c" tone="danger">
              없음
            </StatusDot>
          ),
          r.next ? (
            <StatusDot key="n" tone="warn">
              {r.next.version} · {dotDate(kstDate(r.next.effectiveFrom))}
            </StatusDot>
          ) : (
            ""
          ),
          <span key="n2" className="tabular-nums">
            {r.count}
          </span>,
        ])}
      />
    </>
  );
}
