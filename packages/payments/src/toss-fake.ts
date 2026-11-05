// 가짜 토스 (통합 테스트 · 개발 서버 화면 흐름 테스트용, 운영 빌드에서는 쓰지 않는다 — payments.ts fakeMode).
// 진짜 토스처럼: 결제창에서 결제를 마치면 paymentKey 가 생기고, 승인은 결제창에서 요청한 금액 · 주문 번호와 같아야 하며
// 한 번만 된다. 취소는 남은 금액 안에서만. (토스 테스트 모드도 카드 결제는 카드사 본인 인증을 거쳐서 자동화할 수 없다)
import type { PaymentGateway, TossPayment } from "./toss";
import { GatewayError } from "./toss";

interface FakePayment {
  paymentKey: string;
  orderId: string;
  /** 결제창에서 실제로 요청된 금액 */
  amount: number;
  status: TossPayment["status"];
  cancels: { transactionKey: string; cancelAmount: number; canceledAt: string; key: string }[];
  approvedAt: string | null;
}

export function createFakeToss() {
  const payments = new Map<string, FakePayment>();
  const calls = { confirm: 0, cancel: 0, get: 0, issue: 0, charge: 0, deleteKey: 0 };
  /** 카드 등록창을 마쳐 생긴 authKey ➔ 고객 키 · 카드 이름 */
  const billingAuths = new Map<string, { customerKey: string; card: string }>();
  /** 발급한 빌링키 ➔ 고객 키 · 카드 이름 */
  const billingKeys = new Map<string, { customerKey: string; card: string }>();
  /** 결제를 거절할 빌링키 (한도 초과 · 정지 카드 흉내) */
  const declined = new Set<string>();
  /** 빌링 결제의 멱등 키 ➔ paymentKey (같은 키는 한 번만 결제) */
  const chargedByKey = new Map<string, string>();
  let seq = 0;
  /** 다음 승인 요청을 응답 없이 실패시킨다 (네트워크 끊김 · 시간 초과) */
  let dropNextConfirmResponse = false;

  const view = (p: FakePayment): TossPayment => {
    const canceled = p.cancels.reduce((n, c) => n + c.cancelAmount, 0);
    return {
      paymentKey: p.paymentKey,
      orderId: p.orderId,
      status: p.status,
      totalAmount: p.amount,
      balanceAmount: p.amount - canceled,
      method: "카드",
      approvedAt: p.approvedAt,
      requestedAt: "2026-11-04T10:00:00+09:00",
      card: { issuerCode: "61", number: "12345678****000*", cardType: "신용" },
      easyPay: null,
      receipt: { url: `https://dashboard.tosspayments.com/receipt/${p.paymentKey}` },
      cancels: p.cancels.map(({ key: _key, ...c }) => c),
    };
  };

  const find = (paymentKey: string) => {
    const p = payments.get(paymentKey);
    if (!p) throw new GatewayError("NOT_FOUND_PAYMENT", "존재하지 않는 결제 정보 입니다.", 404);
    return p;
  };

  const gateway: PaymentGateway = {
    async confirm(input) {
      calls.confirm += 1;
      const p = find(input.paymentKey);
      if (p.orderId !== input.orderId || p.amount !== input.amount)
        throw new GatewayError("FORBIDDEN_REQUEST", "결제 요청 정보와 승인 정보가 다릅니다.", 403);
      if (p.status !== "READY" && p.status !== "IN_PROGRESS")
        throw new GatewayError("ALREADY_PROCESSED_PAYMENT", "이미 처리된 결제 입니다.", 400);
      p.status = "DONE";
      p.approvedAt = new Date().toISOString();
      if (dropNextConfirmResponse) {
        dropNextConfirmResponse = false;
        throw new TypeError("fetch failed");
      }
      return view(p);
    },
    async get(paymentKey) {
      calls.get += 1;
      return view(find(paymentKey));
    },
    async cancel(input) {
      calls.cancel += 1;
      const p = find(input.paymentKey);
      const same = p.cancels.find((c) => c.key === input.idempotencyKey);
      if (same) return view(p); // 같은 멱등 키 ➔ 한 번만 취소
      const balance = view(p).balanceAmount;
      if (p.status !== "DONE" && p.status !== "PARTIAL_CANCELED")
        throw new GatewayError("NOT_CANCELABLE_PAYMENT", "취소할 수 없는 결제입니다.", 400);
      if (input.amount > balance)
        throw new GatewayError("NOT_CANCELABLE_AMOUNT", "취소할 수 없는 금액입니다.", 400);
      p.cancels.push({
        transactionKey: `tx-${(seq += 1)}`,
        cancelAmount: input.amount,
        canceledAt: new Date().toISOString(),
        key: input.idempotencyKey,
      });
      p.status = input.amount === balance ? "CANCELED" : "PARTIAL_CANCELED";
      return view(p);
    },
    async issueBillingKey(input) {
      calls.issue += 1;
      const auth = billingAuths.get(input.authKey);
      if (!auth || auth.customerKey !== input.customerKey)
        throw new GatewayError("INVALID_AUTH_KEY", "유효하지 않은 인증 키입니다.", 400);
      billingAuths.delete(input.authKey); // 한 번만 쓸 수 있다
      const billingKey = `bk_fake_${(seq += 1)}`;
      billingKeys.set(billingKey, auth);
      return {
        billingKey,
        customerKey: input.customerKey,
        cardCompany: auth.card,
        cardNumber: "43301234****123*",
        card: { issuerCode: "4V", number: "43301234****123*" },
      };
    },
    async deleteBillingKey(billingKey) {
      calls.deleteKey += 1;
      if (!billingKeys.delete(billingKey))
        throw new GatewayError("NOT_FOUND_BILLING", "존재하지 않는 빌링키입니다.", 404);
      declined.delete(billingKey);
    },
    async chargeBilling(input) {
      calls.charge += 1;
      const done = chargedByKey.get(input.idempotencyKey);
      if (done) return view(find(done));
      const key = billingKeys.get(input.billingKey);
      if (!key || key.customerKey !== input.customerKey)
        throw new GatewayError("NOT_FOUND_BILLING", "존재하지 않는 빌링키입니다.", 404);
      if (declined.has(input.billingKey))
        throw new GatewayError("REJECT_CARD_COMPANY", "카드사에서 결제를 거절했습니다. (한도 초과)", 400);
      const paymentKey = `tpk_bill_${(seq += 1)}`;
      payments.set(paymentKey, {
        paymentKey,
        orderId: input.orderId,
        amount: input.amount,
        status: "DONE",
        cancels: [],
        approvedAt: new Date().toISOString(),
      });
      chargedByKey.set(input.idempotencyKey, paymentKey);
      return view(find(paymentKey));
    },
  };

  return {
    gateway,
    calls,
    payments,
    /** 사용자가 결제창에서 결제를 마쳤다 (금액은 결제창에 실제로 넘어간 값) */
    authorize(orderId: string, amount: number): string {
      const paymentKey = `tpk_fake_${(seq += 1)}`;
      payments.set(paymentKey, {
        paymentKey,
        orderId,
        amount,
        status: "READY",
        cancels: [],
        approvedAt: null,
      });
      return paymentKey;
    },
    /** 토스 상점 관리자에서 직접 취소 (우리 서버를 거치지 않음) */
    cancelOutside(paymentKey: string, amount: number) {
      const p = find(paymentKey);
      p.cancels.push({
        transactionKey: `tx-${(seq += 1)}`,
        cancelAmount: amount,
        canceledAt: new Date().toISOString(),
        key: `outside-${seq}`,
      });
      p.status = view(p).balanceAmount === 0 ? "CANCELED" : "PARTIAL_CANCELED";
    },
    dropNextConfirmResponse() {
      dropNextConfirmResponse = true;
    },
    /** 사용자가 카드 등록창을 마쳤다 ➔ authKey */
    authorizeBilling(customerKey: string, card = "신한카드"): string {
      const authKey = `bln_fake_${(seq += 1)}`;
      billingAuths.set(authKey, { customerKey, card });
      return authKey;
    },
    /** 이 빌링키의 결제를 거절하게 / 다시 되게 */
    setDeclined(billingKey: string, value: boolean) {
      if (value) declined.add(billingKey);
      else declined.delete(billingKey);
    },
    billingKeys,
  };
}
