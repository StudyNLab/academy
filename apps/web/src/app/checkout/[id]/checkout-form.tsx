"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button, Checkbox, Notice } from "@aionit/ui";
import { won } from "@/components/commerce/format";
import { api } from "@/lib/client-api";

// 토스페이먼츠 결제위젯 (JavaScript SDK v2). 주문서에 결제 수단 · 토스 약관 UI 를 그리고, 결제하기를 누르면 결제창을 연다.
// CSP 'strict-dynamic': 우리 스크립트(nonce)가 넣은 스크립트라 따로 허용하지 않아도 된다 (src/proxy.ts)
const SDK_URL = "https://js.tosspayments.com/v2/standard";

interface TossWidgets {
  setAmount(amount: { currency: "KRW"; value: number }): Promise<void>;
  renderPaymentMethods(options: { selector: string; variantKey: string }): Promise<unknown>;
  renderAgreement(options: { selector: string; variantKey: string }): Promise<unknown>;
  requestPayment(options: {
    orderId: string;
    orderName: string;
    successUrl: string;
    failUrl: string;
  }): Promise<void>;
}

declare global {
  interface Window {
    TossPayments?: (clientKey: string) => { widgets(options: { customerKey: string }): TossWidgets };
  }
}

let sdk: Promise<NonNullable<Window["TossPayments"]>> | null = null;

function loadSdk() {
  sdk ??= new Promise((resolve, reject) => {
    if (window.TossPayments) return resolve(window.TossPayments);
    const script = document.createElement("script");
    script.src = SDK_URL;
    script.async = true;
    script.onload = () =>
      window.TossPayments ? resolve(window.TossPayments) : reject(new Error("load failed"));
    script.onerror = () => {
      sdk = null;
      reject(new Error("load failed"));
    };
    document.head.appendChild(script);
  });
  return sdk;
}

interface PayParams {
  orderId: string;
  orderName: string;
  amount: number;
  successUrl: string;
  failUrl: string;
}

function tossMessage(e: unknown): string {
  const code = (e as { code?: string }).code;
  if (code === "USER_CANCEL" || code === "PAY_PROCESS_CANCELED")
    return "결제를 취소했습니다. 다시 결제할 수 있습니다.";
  if (e instanceof Error && e.message === "load failed")
    return "결제 화면을 불러오지 못했습니다. 인터넷 연결을 확인하고 새로고침해 주세요.";
  return `결제 화면 오류: ${(e as { message?: string }).message ?? "다시 시도해 주세요."}`;
}

export function CheckoutForm({
  orderId,
  amount,
  clientKey,
  customerKey,
  testMode,
  fake = false,
}: {
  orderId: string;
  /** 주문 스냅샷 금액 (서버가 승인 때 다시 대조한다) */
  amount: number;
  clientKey: string;
  customerKey: string;
  testMode: boolean;
  /** 개발 서버 가짜 결제 (화면 흐름 테스트) */
  fake?: boolean;
}) {
  const router = useRouter();
  const widgets = useRef<TossWidgets | null>(null);
  const [ready, setReady] = useState(fake);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const started = useRef(false);

  useEffect(() => {
    // 결제위젯은 한 화면에 한 번만 그릴 수 있다 (개발 모드에서 effect 가 두 번 돌아도 한 번만)
    if (started.current || fake) return;
    started.current = true;
    void (async () => {
      try {
        const TossPayments = await loadSdk();
        const w = TossPayments(clientKey).widgets({ customerKey });
        await w.setAmount({ currency: "KRW", value: amount });
        await Promise.all([
          w.renderPaymentMethods({ selector: "#toss-payment-methods", variantKey: "DEFAULT" }),
          w.renderAgreement({ selector: "#toss-agreement", variantKey: "AGREEMENT" }),
        ]);
        widgets.current = w;
        setReady(true);
      } catch (e) {
        setError(tossMessage(e));
      }
    })();
  }, [clientKey, customerKey, amount, fake]);

  async function onPay() {
    if (!widgets.current && !fake) return;
    setBusy(true);
    setError(null);
    // 동의를 서버에 남기고 결제창에 넘길 값을 받는다 (금액은 주문 스냅샷, 30분 지난 주문서는 거절)
    const result = await api<PayParams>(`/orders/${orderId}/agree`, {});
    if (!result.ok) {
      setBusy(false);
      if (result.error.code === "ORDER_EXPIRED" || result.error.code === "ORDER_CLOSED") router.refresh();
      return setError(result.error.message);
    }
    const p = result.data;
    if (fake) {
      const auth = await api<{ paymentKey: string }>("/payments/fake-authorize", {
        orderId: p.orderId,
        amount: p.amount,
      });
      if (!auth.ok) {
        setBusy(false);
        return setError(auth.error.message);
      }
      const query = new URLSearchParams({
        paymentKey: auth.data.paymentKey,
        orderId: p.orderId,
        amount: String(p.amount),
      });
      window.location.assign(`${p.successUrl}?${query}`);
      return;
    }
    try {
      await widgets.current!.requestPayment({
        orderId: p.orderId,
        orderName: p.orderName,
        successUrl: p.successUrl,
        failUrl: p.failUrl,
      });
      // 결제창은 성공 · 실패 주소로 이동한다
    } catch (e) {
      setError(tossMessage(e));
    }
    setBusy(false);
  }

  return (
    <div className="mt-6 flex flex-col gap-4 border-t-2 border-line-strong pt-5">
      <p className="m-0 text-[14px] text-ink-2">
        결제 수단 (토스페이먼츠){testMode ? " · 테스트 모드라 실제로 돈이 나가지 않습니다" : ""}
      </p>
      {fake ? (
        <Notice tone="warn" title="개발용 가짜 결제">
          개발 서버 화면 흐름 테스트용입니다. 토스를 거치지 않고 결제가 끝난 것으로 처리합니다.
        </Notice>
      ) : (
        /* 결제위젯이 그리는 자리 (토스 화면, 밝은 바탕) */
        <div className="rounded-ui bg-white">
          <div id="toss-payment-methods" />
          <div id="toss-agreement" />
        </div>
      )}
      {!ready && !error ? <p className="m-0 text-[14px] text-ink-2">결제 수단을 불러오는 중…</p> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Checkbox checked={agreed} onChange={(e) => setAgreed(e.target.checked)}>
        (필수) 주문 내용과 환불 규정을 확인했으며 결제에 동의합니다
      </Checkbox>
      <Button variant="primary" size="lg" disabled={!agreed || !ready || busy} onClick={() => void onPay()}>
        {busy ? "결제창을 여는 중…" : `${won(amount)} 결제하기`}
      </Button>
    </div>
  );
}
