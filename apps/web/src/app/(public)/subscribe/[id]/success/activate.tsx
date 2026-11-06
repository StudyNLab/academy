"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Notice } from "@aionit/ui";
import { lastDay } from "@/components/commerce/format";
import { SvcIcon } from "@/components/icons";
import { ResultPage } from "@/components/result-page";
import { api } from "@/lib/client-api";

type State =
  { kind: "working" } | { kind: "done"; periodEnd: string | null } | { kind: "failed"; message: string };

export function ActivateSubscription({
  subscriptionId,
  authKey,
  customerKey,
}: {
  subscriptionId: string;
  authKey: string;
  customerKey: string;
}) {
  const [state, setState] = useState<State>({ kind: "working" });
  const started = useRef(false);

  useEffect(() => {
    // 개발 모드에서 effect 가 두 번 돌아도 요청은 한 번 (서버도 두 번 시작하지 않는다)
    if (started.current) return;
    started.current = true;
    if (!authKey || !customerKey) {
      setState({ kind: "failed", message: "카드 등록 정보가 올바르지 않습니다." });
      return;
    }
    void api<{ status: string; periodEnd: string | null }>(`/subscriptions/${subscriptionId}`, {
      action: "activate",
      authKey,
      customerKey,
    }).then((r) =>
      setState(
        r.ok ? { kind: "done", periodEnd: r.data.periodEnd } : { kind: "failed", message: r.error.message },
      ),
    );
  }, [subscriptionId, authKey, customerKey]);

  if (state.kind === "working")
    return (
      <ResultPage
        status
        eyebrow="SUBSCRIPTION"
        title="카드를 등록하고 결제하고 있습니다…"
        desc="이 화면을 닫지 말고 잠시 기다려 주세요."
      />
    );
  if (state.kind === "failed")
    return (
      <ResultPage
        eyebrow="SUBSCRIPTION RESULT"
        title="구독을 시작하지 못했습니다"
        mark="fail"
        body={<Notice tone="danger">{state.message}</Notice>}
        actions={
          <Link href="/subscribe" className="btn primary">
            다시 신청 <SvcIcon name="arrow" />
          </Link>
        }
      />
    );
  return (
    <ResultPage
      eyebrow="SUBSCRIPTION RESULT"
      title="구독이 시작되었습니다"
      desc="이제 내 강의실에서 배움을 시작하세요."
      mark="done"
      heading="포함 강의를 자유롭게 만나보세요."
      body="영수증을 메일로 보냈습니다."
      items={
        state.periodEnd
          ? [["이용 기간", `${lastDay(new Date(state.periodEnd))} 까지 · 그날 자동으로 다음 결제`]]
          : []
      }
      actions={
        <>
          <Link href="/learn" className="btn primary">
            내 강의실 <SvcIcon name="arrow" />
          </Link>
          <Link href="/my/subscription" className="btn secondary">
            구독 관리
          </Link>
        </>
      }
    />
  );
}
