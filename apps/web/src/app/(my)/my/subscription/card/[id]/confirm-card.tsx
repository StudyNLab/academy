"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { buttonClass, Notice } from "@aionit/ui";
import { api } from "@/lib/client-api";

type State =
  { kind: "working" } | { kind: "done"; message: string; ok: boolean } | { kind: "failed"; message: string };

export function ConfirmCard({
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
    if (started.current) return;
    started.current = true;
    if (!authKey || !customerKey) {
      setState({ kind: "failed", message: "카드 등록 정보가 올바르지 않습니다." });
      return;
    }
    void api<{ retried: boolean; ok: boolean; message: string | null }>(`/subscriptions/${subscriptionId}`, {
      action: "card",
      authKey,
      customerKey,
    }).then((r) => {
      if (!r.ok) return setState({ kind: "failed", message: r.error.message });
      const d = r.data;
      setState({
        kind: "done",
        ok: d.ok,
        message: !d.retried
          ? "결제 수단을 바꿨습니다. 다음 결제부터 이 카드로 결제합니다."
          : d.ok
            ? "결제 수단을 바꾸고 밀린 결제를 마쳤습니다. 구독이 이어집니다."
            : `결제 수단은 바꿨지만 결제에 다시 실패했습니다: ${d.message}`,
      });
    });
  }, [subscriptionId, authKey, customerKey]);

  return (
    <div className="flex flex-col gap-5">
      <h1 className="m-0 text-[32px] font-semibold tracking-[-0.035em]">결제 수단 변경</h1>
      {state.kind === "working" ? (
        <p className="m-0 text-ink-2" role="status">
          카드를 등록하고 있습니다…
        </p>
      ) : (
        <Notice tone={state.kind === "done" && state.ok ? "done" : "danger"}>{state.message}</Notice>
      )}
      <Link href="/my/subscription" className={buttonClass("outline", "md", "self-start")}>
        구독 관리로
      </Link>
    </div>
  );
}
