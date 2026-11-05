import type { Metadata } from "next";
import Link from "next/link";
import { formatRate, kstDate } from "@aionit/core";
import { asc, schema } from "@aionit/db";
import { StatusDot } from "@aionit/ui";
import { PageTitle } from "@/components/page-title";
import { dotDate, Section, Table } from "@/components/settlement-view";
import { getDb } from "@/server/db";
import { requireStaff } from "@/server/session";
import { POLICY_SCOPE_LABEL, policyOverview } from "@/server/settlements";
import { CoursePolicyForm, DefaultPolicyForm } from "../settlement-forms";

export const metadata: Metadata = { title: "배분 정책" };

const pct = (bp: number | null) => (bp === null ? "기본 따름" : formatRate(bp));

// AD-16 배분 정책 관리 (사이트구조 9장): 기본 정책 · 강사별 비율(AD-15) · 과정 예외를 시행일과 함께 새 버전으로
export default async function AdminRevenuePolicies() {
  await requireStaff("operator", "/admin/settlements/policies");
  const db = getDb();
  const now = new Date();
  const { rows, current } = await policyOverview(db, now);
  const courses = await db
    .select({ id: schema.courses.id, title: schema.courses.title })
    .from(schema.courses)
    .orderBy(asc(schema.courses.title));
  const tomorrow = kstDate(new Date(now.getTime() + 86_400_000));
  const asPercent = (bp: number) => String(bp / 100);

  return (
    <>
      <PageTitle label="Revenue policy" title="배분 정책">
        <p className="m-0">
          <Link href="/admin/settlements">← 정산 관리</Link> · 비율 · 방식 · 상한은 고치지 않고 새 버전으로
          쌓고, 시행일 이후 매출부터 적용합니다. 이미 확정한 정산은 바뀌지 않습니다. 매출마다 가장 좁은
          범위(과정 ➔ 강사 ➔ 기본)의 정책을 씁니다. 강사별 단건 비율은{" "}
          <Link href="/admin/instructors">강사 관리</Link>에서 등록합니다.
        </p>
      </PageTitle>

      <Table
        empty="정책이 없습니다."
        left={3}
        head={["시행일", "범위 · 대상", "이름", "단건 강사", "구독 풀", "추정 수수료", "하루 상한"]}
        rows={rows.map((p) => [
          <span key="d" className="flex flex-col gap-1">
            <span className="tabular-nums">{dotDate(kstDate(p.effectiveFrom))}</span>
            <StatusDot tone={p.inForce ? "done" : "warn"}>{p.inForce ? "시행" : "시행 예정"}</StatusDot>
          </span>,
          `${POLICY_SCOPE_LABEL[p.scope]}${p.target ? ` · ${p.target}` : ""}`,
          p.note,
          pct(p.singleRateBp),
          p.scope === "default" ? pct(p.subscriptionPoolRateBp) : "",
          p.scope === "default" ? pct(p.pgFeeRateBp) : "",
          p.rules ? `${p.rules.dailyCapSec / 3600}시간` : "",
        ])}
      />
      <p className="mt-3 text-[13px] text-ink-2">
        &quot;시행&quot;은 지금까지 시행일이 지난 버전입니다. 같은 범위에서는 시행일이 가장 늦은 것이 지금
        적용됩니다.
      </p>

      <Section title="기본 정책 새 버전">
        <div className="max-w-[720px]">
          <DefaultPolicyForm
            tomorrow={tomorrow}
            current={{
              single: current ? asPercent(current.singleRateBp) : "60",
              pool: current ? asPercent(current.poolRateBp) : "50",
              fee: current ? asPercent(current.pgFeeRateBp) : "3.4",
              capHours: String((current?.learningRules.dailyCapSec ?? 10_800) / 3600),
            }}
          />
        </div>
      </Section>

      <Section title="과정 예외 (단건 비율)">
        <div className="max-w-[720px]">
          {courses.length > 0 ? (
            <CoursePolicyForm tomorrow={tomorrow} courses={courses} />
          ) : (
            <p className="m-0 text-ink-2">과정이 없습니다.</p>
          )}
        </div>
      </Section>
    </>
  );
}
