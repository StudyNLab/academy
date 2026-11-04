"use client";

// 토스페이먼츠 JavaScript SDK v2. 결제 버튼 · 카드 등록 버튼을 누를 때 처음 불러온다.
// CSP 'strict-dynamic': 우리 스크립트(nonce)가 넣은 스크립트라 따로 허용하지 않아도 된다 (src/proxy.ts)
import { api } from "@/lib/client-api";

const SDK_URL = "https://js.tosspayments.com/v2/standard";

export interface TossWidgets {
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

interface TossInstance {
  /** 결제위젯 (단건, 결제위젯 연동 키) */
  widgets(options: { customerKey: string }): TossWidgets;
  /** 결제창 · 카드 등록창 (자동결제, API 개별 연동 키) */
  payment(options: { customerKey: string }): {
    requestBillingAuth(options: { method: "CARD"; successUrl: string; failUrl: string }): Promise<void>;
  };
}

declare global {
  interface Window {
    TossPayments?: (clientKey: string) => TossInstance;
  }
}

let sdk: Promise<NonNullable<Window["TossPayments"]>> | null = null;

export function loadTossSdk() {
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

/** 토스 SDK 오류 ➔ 쉬운 말 */
export function tossMessage(e: unknown): string {
  const code = (e as { code?: string }).code;
  if (code === "USER_CANCEL" || code === "PAY_PROCESS_CANCELED")
    return "취소했습니다. 다시 시도할 수 있습니다.";
  if (e instanceof Error && e.message === "load failed")
    return "결제 화면을 불러오지 못했습니다. 인터넷 연결을 확인하고 새로고침해 주세요.";
  return `결제 화면 오류: ${(e as { message?: string }).message ?? "다시 시도해 주세요."}`;
}

export interface BillingAuthParams {
  customerKey: string;
  clientKey: string | null;
  fake: boolean;
  successUrl: string;
  failUrl: string;
}

/**
 * 카드 등록창(자동결제)을 연다. 등록을 마치면 토스가 successUrl 에 customerKey · authKey 를 붙여 돌려보낸다.
 * 개발 서버 가짜 모드는 바로 authKey 를 받아 같은 주소로 보낸다. 실패하면 오류 문장
 */
export async function openBillingAuth(p: BillingAuthParams): Promise<string | null> {
  if (p.fake) {
    const auth = await api<{ authKey: string }>("/payments/fake-billing-auth", {
      customerKey: p.customerKey,
    });
    if (!auth.ok) return auth.error.message;
    const query = new URLSearchParams({ customerKey: p.customerKey, authKey: auth.data.authKey });
    window.location.assign(`${p.successUrl}?${query}`);
    return null;
  }
  if (!p.clientKey) return "구독 신청을 준비하고 있습니다.";
  try {
    const TossPayments = await loadTossSdk();
    await TossPayments(p.clientKey)
      .payment({ customerKey: p.customerKey })
      .requestBillingAuth({ method: "CARD", successUrl: p.successUrl, failUrl: p.failUrl });
    return null;
  } catch (e) {
    return tossMessage(e);
  }
}
