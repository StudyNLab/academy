"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { buttonClass, MonoLabel, Notice } from "@aionit/ui";
import { lastDay } from "@/components/commerce/format";
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
      <div className="flex flex-col gap-3" role="status">
        <MonoLabel className="text-xs text-signal">Subscription</MonoLabel>
        <h1 className="m-0 text-[32px] font-semibold tracking-[-0.035em]">
          카드를 등록하고 결제하고 있습니다…
        </h1>
        <p className="m-0 text-ink-2">이 화면을 닫지 말고 잠시 기다려 주세요.</p>
      </div>
    );
  if (state.kind === "failed")
    return (
      <div className="flex flex-col gap-5">
        <MonoLabel className="text-xs text-danger">Subscription failed</MonoLabel>
        <h1 className="m-0 text-[32px] font-semibold tracking-[-0.035em]">구독을 시작하지 못했습니다</h1>
        <Notice tone="danger">{state.message}</Notice>
        <Link href="/subscribe" className={buttonClass("primary", "md", "self-start")}>
          다시 신청
        </Link>
      </div>
    );
  return (
    <div className="flex flex-col gap-5">
      <MonoLabel className="text-xs text-done">Subscribed</MonoLabel>
      <h1 className="m-0 text-[32px] font-semibold tracking-[-0.035em]">구독이 시작되었습니다</h1>
      <p className="m-0 text-ink-2">
        {state.periodEnd
          ? `${lastDay(new Date(state.periodEnd))} 까지 이용하고, 그날 자동으로 다음 결제를 합니다. `
          : ""}
        영수증을 메일로 보냈습니다.
      </p>
      <div className="flex flex-wrap gap-4">
        <Link href="/learn" className={buttonClass("primary", "lg")}>
          내 강의실
        </Link>
        <Link href="/my/subscription" className={buttonClass("outline", "lg")}>
          구독 관리
        </Link>
      </div>
    </div>
  );
}
