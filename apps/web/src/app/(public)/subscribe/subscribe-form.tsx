"use client";

import { useState } from "react";
import { Button, Checkbox, Notice } from "@aionit/ui";
import { won } from "@/components/commerce/format";
import type { BillingAuthParams } from "@/components/commerce/toss-sdk";
import { openBillingAuth } from "@/components/commerce/toss-sdk";
import { api } from "@/lib/client-api";

interface Plan {
  productId: string;
  name: string;
  interval: "month" | "year";
  amount: number;
  /** 다음 자동결제일 (보여 주기용) */
  nextBilling: string;
}

// C-04 구독 신청: 요금제 ➔ 꼭 확인할 내용 ➔ 자동결제 동의 · 약관 동의 (따로) ➔ 카드 등록창 ➔ 첫 결제
export function SubscribeForm({ plans }: { plans: Plan[] }) {
  const [productId, setProductId] = useState(
    plans.find((p) => p.interval === "year")?.productId ?? plans[0]!.productId,
  );
  const [autoRenew, setAutoRenew] = useState(false);
  const [terms, setTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const plan = plans.find((p) => p.productId === productId)!;

  async function onSubmit() {
    setBusy(true);
    setError(null);
    const result = await api<BillingAuthParams & { subscriptionId: string }>("/subscriptions", {
      productId,
      autoRenewAgreed: autoRenew,
      termsAgreed: terms,
    });
    if (!result.ok) {
      setBusy(false);
      return setError(result.error.message);
    }
    const failed = await openBillingAuth(result.data);
    if (failed) setError(failed);
    setBusy(false);
  }

  return (
    <div className="flex max-w-[640px] flex-col gap-5">
      <h2 className="m-0 text-[21px] font-semibold">구독 신청</h2>
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-2 text-sm font-semibold">요금제</legend>
        {plans.map((p) => (
          <label key={p.productId} className="flex min-h-11 cursor-pointer items-center gap-3 text-[15px]">
            <input
              type="radio"
              name="plan"
              value={p.productId}
              checked={p.productId === productId}
              onChange={() => setProductId(p.productId)}
              className="h-[18px] w-[18px] accent-[var(--primary)]"
            />
            {p.interval === "year" ? "연간" : "월간"} {won(p.amount)} / {p.interval === "year" ? "년" : "월"}
          </label>
        ))}
      </fieldset>
      <div className="border-t border-line pt-4 text-[14px] leading-[1.75]">
        <p className="m-0 font-semibold">꼭 확인하세요</p>
        <ul className="m-0 list-none p-0 text-ink-2">
          <li>
            · 오늘 {won(plan.amount)}이 결제되고, {plan.nextBilling} 에 같은 금액이 자동으로 결제됩니다 (그
            뒤에도 {plan.interval === "year" ? "매년" : "매달"})
          </li>
          <li>· 마이페이지 &gt; 구독 관리에서 언제든 해지할 수 있습니다</li>
          <li>· 가격이 오르면 30일 전에 알리고 동의를 받습니다</li>
          <li>· 7일 이내 + 학습 전 전액 환불, 그 뒤 즉시 해지는 남은 날 일할 − 위약금 10%</li>
        </ul>
      </div>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <div className="flex flex-col">
        <Checkbox checked={autoRenew} onChange={(e) => setAutoRenew(e.target.checked)}>
          (필수) 위 내용과 정기결제(자동결제)에 동의합니다
        </Checkbox>
        <Checkbox checked={terms} onChange={(e) => setTerms(e.target.checked)}>
          (필수) 구독 이용약관 · 환불 규정에 동의합니다
        </Checkbox>
      </div>
      <Button
        variant="primary"
        size="lg"
        disabled={!autoRenew || !terms || busy}
        onClick={() => void onSubmit()}
      >
        {busy ? "카드 등록창을 여는 중…" : `카드 등록하고 ${won(plan.amount)} 결제`}
      </Button>
      <p className="m-0 text-[13px] leading-[1.7] text-ink-2">
        다음 화면(토스페이먼츠 카드 등록창)에서 카드번호 · 유효기간 · 생년월일 6자리를 입력합니다. 카드사가
        본인 카드인지 확인하는 데 쓰며, 주민등록번호 뒷자리와 카드 비밀번호는 묻지 않습니다. 카드 정보는
        토스페이먼츠가 보관하고 AIONIT 에는 저장하지 않습니다.
      </p>
    </div>
  );
}
