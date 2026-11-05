// 정산 명세 보기 (I-08 강사 · AD-16 운영자 공용). 상태는 점 + 글, 금액은 원 단위 (화면상세기획 0.4).
// 구매자 · 주문 번호는 보이지 않는다 (근거 줄에 결제일 · 과정 · 금액만).
import type { ReactNode } from "react";
import { formatRate, formatShare, HOLD_LABEL } from "@aionit/core";
import { StatusDot } from "@aionit/ui";
import type { StatementLine } from "@/server/settlements";

export const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;
const num = (n: number) => n.toLocaleString("ko-KR");
export const dotDate = (day: string) => day.replaceAll("-", ".");
export const monthLabel = (month: string) => `${month.slice(0, 4)}년 ${Number(month.slice(5))}월`;

type Tone = "done" | "warn" | "danger" | "muted";

/** 강사 정산 상태 */
export function settlementState(s: {
  status: "calculated" | "confirmed" | "paid";
  payoutAmount: number;
  holdReason: keyof typeof HOLD_LABEL | null;
}): { tone: Tone; label: string } {
  if (s.status === "calculated") return { tone: "muted", label: "계산됨 · 확정 전" };
  if (s.status === "paid") return { tone: "done", label: "지급함" };
  if (s.payoutAmount === 0)
    return { tone: "muted", label: s.holdReason ? HOLD_LABEL[s.holdReason] : "지급할 금액 없음" };
  return { tone: "warn", label: "확정 · 지급 대기" };
}

export const PERIOD_STATE: Record<"calculated" | "confirmed", { tone: Tone; label: string }> = {
  calculated: { tone: "warn", label: "계산됨 · 확정 전" },
  confirmed: { tone: "done", label: "확정 · 명세 공개" },
};

export function StateDot({ state }: { state: { tone: Tone; label: string } }) {
  return <StatusDot tone={state.tone}>{state.label}</StatusDot>;
}

export interface SettlementAmounts {
  singleAmount: number;
  subscriptionAmount: number;
  refundAmount: number;
  adjustmentAmount: number;
  carriedIn: number;
  withheld: number;
  vatAmount: number;
  payoutAmount: number;
  grossAmount: number;
  carryOut: number;
  taxType: "individual" | "business" | null;
}

/** 위쪽 숫자 칸: 단건 · 구독 · 환불 · (조정) · 이월 · 원천징수(또는 부가세) · 지급 예정액 */
export function AmountTiles({ s }: { s: SettlementAmounts }) {
  const tiles: { label: string; value: string; strong?: boolean }[] = [
    { label: "단건 매출", value: num(s.singleAmount) },
    { label: "구독 배분", value: num(s.subscriptionAmount) },
    { label: "환불 차감", value: num(s.refundAmount) },
    ...(s.adjustmentAmount !== 0 ? [{ label: "조정", value: num(s.adjustmentAmount) }] : []),
    { label: "이월", value: num(s.carriedIn) },
    s.taxType === "business"
      ? { label: "부가세 (세금계산서)", value: num(s.vatAmount) }
      : { label: "원천징수 3.3%", value: num(-s.withheld) },
    { label: "지급 예정액", value: num(s.payoutAmount), strong: true },
  ];
  return (
    <dl className="m-0 grid grid-cols-2 border-t border-line-strong sm:grid-cols-3 lg:grid-cols-4">
      {tiles.map((tile) => (
        <div key={tile.label} className="flex min-w-0 flex-col gap-1 border-b border-line py-4 pr-4">
          <dt className="text-[13px] text-ink-2">{tile.label}</dt>
          <dd
            className={`m-0 font-semibold tabular-nums tracking-[-0.03em] ${tile.strong ? "text-[28px] text-signal" : "text-[22px]"}`}
          >
            {tile.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function Section({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="mt-12 border-t border-line-strong pt-6">
      <h2 className="m-0 mb-5 text-[21px] font-semibold tracking-[-0.02em]">{title}</h2>
      {children}
    </section>
  );
}

/** 표: 좁은 화면에서는 표 안에서만 가로로 움직인다 (화면 전체는 넘치지 않게) */
export function Table({
  head,
  rows,
  empty,
  left = 2,
}: {
  head: string[];
  rows: ReactNode[][];
  empty: string;
  /** 왼쪽 정렬 칸 수 (나머지는 숫자, 오른쪽 정렬) */
  left?: number;
}) {
  if (rows.length === 0) return <p className="m-0 text-ink-2">{empty}</p>;
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full min-w-[560px] border-collapse text-[14px]">
        <thead>
          <tr className="border-b border-line-strong text-left text-[13px] text-ink-2">
            {head.map((h, i) => (
              <th key={h} scope="col" className={`py-2 pr-3 font-medium ${i >= left ? "text-right" : ""}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, r) => (
            <tr key={r} className="border-b border-line">
              {cells.map((cell, i) => (
                <td key={i} className={`py-2 pr-3 align-top ${i >= left ? "text-right tabular-nums" : ""}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const hours = (sec: number) => `${num(Math.round((sec / 3600) * 10) / 10)}시간`;

/** 근거 줄: 단건 · 환불 차감 · 구독 배분 · 조정 */
export function StatementLines({ lines, showFee = true }: { lines: StatementLine[]; showFee?: boolean }) {
  const single = lines.filter((l) => l.kind === "single");
  const refunds = lines.filter((l) => l.kind === "refund");
  const subs = lines.filter((l) => l.kind === "subscription");
  const adjustments = lines.filter((l) => l.kind === "adjustment");
  const pool = subs[0]?.pool;
  const fee = (l: StatementLine) => (l.fee === null ? "" : `${num(l.fee)}${l.feeEstimated ? " (추정)" : ""}`);
  return (
    <>
      <Section title="단건 매출">
        <Table
          empty="이 달에 판 단건 강의가 없습니다."
          head={[
            "결제일",
            "과정",
            "결제액",
            ...(showFee ? ["수수료"] : []),
            "정산 기준액",
            "비율",
            "강사 몫",
          ]}
          rows={single.map((l) => [
            dotDate(l.date.slice(5)),
            l.courseTitle,
            num(l.paid ?? 0),
            ...(showFee ? [fee(l)] : []),
            num(l.base),
            l.rateBp === null ? "" : formatRate(l.rateBp),
            num(l.amount),
          ])}
        />
        <p className="mt-3 text-[13px] text-ink-2">
          정산 기준액 = 결제액 − 부가세 − 결제 수수료. 구매자 정보는 보이지 않습니다. 수수료
          &quot;(추정)&quot;은 결제 대행사 수수료가 아직 기록되지 않아 배분 정책의 추정 수수료율로 계산한
          값입니다.
        </p>
      </Section>
      <Section title="구독 배분">
        {pool !== undefined ? (
          <p className="m-0 mb-4 text-[15px]">
            이번 달 강사 배분 풀 <strong className="tabular-nums">{won(pool)}</strong> 중
          </p>
        ) : null}
        <Table
          empty="이 달에 구독으로 배분된 금액이 없습니다."
          left={1}
          head={["과정", "유효 학습 시간", "전체 대비", "배분액"]}
          rows={subs.map((l) => [
            l.courseTitle,
            hours(l.seconds ?? 0),
            l.rateBp === null ? "" : formatShare(l.rateBp),
            num(l.amount),
          ])}
        />
        <p className="mt-3 text-[13px] text-ink-2">
          구독 포함 과정을 구독으로 본 유효 학습 시간에 비례합니다 (수강생 1명 · 과정 1개 · 하루 3시간까지,
          강사 본인 · 운영자 · 단건으로 산 수강생의 시간은 빼고).
        </p>
      </Section>
      {refunds.length > 0 ? (
        <Section title="환불 차감">
          <Table
            empty=""
            head={["환불일", "과정", "환불액", "판매한 달", "비율", "차감 (강사 몫)"]}
            rows={refunds.map((l) => [
              dotDate(l.date.slice(5)),
              l.courseTitle,
              num(l.paid ?? 0),
              l.saleMonth ? monthLabel(l.saleMonth) : "",
              l.rateBp === null ? "" : formatRate(l.rateBp),
              num(l.amount),
            ])}
          />
          <p className="mt-3 text-[13px] text-ink-2">
            환불액 전체가 아니라 그 환불에 해당하는 강사 몫만 뺍니다. 지난달 정산을 확정한 뒤의 환불은 이번
            달에서 뺍니다.
          </p>
        </Section>
      ) : null}
      {adjustments.length > 0 ? (
        <Section title="조정">
          <Table
            empty=""
            head={["날짜", "사유", "금액"]}
            rows={adjustments.map((l) => [dotDate(l.date), l.reason ?? "", num(l.amount)])}
          />
        </Section>
      ) : null}
    </>
  );
}

export function TaxNotice() {
  return (
    <p className="mt-10 text-[13px] leading-[1.7] text-ink-2">
      세금 처리(원천징수 3.3% · 사업자 세금계산서 · 부가세)는 기준안이며, 실제 서비스를 열기 전에 세무사
      확인을 받아 바뀔 수 있습니다. 개인 강사는 사업소득 3%와 지방소득세 0.3%(각각 10원 미만 버림)를 빼고
      받고, 사업자 강사는 강사 몫에 부가세를 더한 세금계산서를 발행합니다.
    </p>
  );
}
