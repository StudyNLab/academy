// 토스페이먼츠 어댑터 (테스트 모드, docs/기술설계.md 6장). 결제 승인 · 조회 · 취소 + 자동결제(빌링키 발급 · 빌링 결제).
// 비밀 키는 서버에서만 쓰고, 토스 응답은 zod 로 검사한다. 테스트는 같은 모양의 가짜 어댑터(toss-fake.ts)를 쓴다.
// 키 묶음이 둘이다: 단건은 결제위젯 연동 키, 자동결제는 API 개별 연동 키 (토스는 결제한 키 묶음으로만 취소된다)
import { z } from "zod";

export const TOSS_STATUSES = [
  "READY",
  "IN_PROGRESS",
  "WAITING_FOR_DEPOSIT",
  "DONE",
  "CANCELED",
  "PARTIAL_CANCELED",
  "ABORTED",
  "EXPIRED",
] as const;

const paymentSchema = z.object({
  paymentKey: z.string(),
  orderId: z.string(),
  status: z.enum(TOSS_STATUSES),
  totalAmount: z.number().int(),
  balanceAmount: z.number().int(),
  method: z.string().nullish(),
  approvedAt: z.string().nullish(),
  requestedAt: z.string().nullish(),
  card: z
    .object({
      issuerCode: z.string().nullish(),
      number: z.string().nullish(),
      cardType: z.string().nullish(),
      approveNo: z.string().nullish(),
    })
    .nullish(),
  easyPay: z.object({ provider: z.string().nullish() }).nullish(),
  receipt: z.object({ url: z.string() }).nullish(),
  cancels: z
    .array(
      z.object({
        transactionKey: z.string(),
        cancelAmount: z.number().int(),
        canceledAt: z.string().nullish(),
        cancelReason: z.string().nullish(),
      }),
    )
    .nullish(),
});

export type TossPayment = z.infer<typeof paymentSchema>;

/** DB 에 남길 토스 응답 (필요한 것만. 카드 번호는 토스가 가린 값) */
export function trimPayment(p: TossPayment) {
  return {
    paymentKey: p.paymentKey,
    orderId: p.orderId,
    status: p.status,
    method: p.method ?? null,
    totalAmount: p.totalAmount,
    balanceAmount: p.balanceAmount,
    requestedAt: p.requestedAt ?? null,
    approvedAt: p.approvedAt ?? null,
    card: p.card ? { issuerCode: p.card.issuerCode, number: p.card.number, cardType: p.card.cardType } : null,
    easyPay: p.easyPay?.provider ?? null,
    cancels: (p.cancels ?? []).map((c) => ({
      transactionKey: c.transactionKey,
      cancelAmount: c.cancelAmount,
      canceledAt: c.canceledAt,
    })),
  };
}

/** 토스가 거절한 요청 (code 는 토스 오류 코드) */
export class GatewayError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus: number,
  ) {
    super(message);
  }
}

const billingAuthSchema = z.object({
  billingKey: z.string(),
  customerKey: z.string(),
  cardCompany: z.string().nullish(),
  cardNumber: z.string().nullish(),
  card: z.object({ issuerCode: z.string().nullish(), number: z.string().nullish() }).nullish(),
});

export type TossBillingAuth = z.infer<typeof billingAuthSchema>;

export interface PaymentGateway {
  /** 결제 승인: 결제창에서 돌아온 paymentKey · orderId · amount 를 토스에 다시 확인하고 돈을 받는다 */
  confirm(input: { paymentKey: string; orderId: string; amount: number }): Promise<TossPayment>;
  get(paymentKey: string): Promise<TossPayment>;
  /** 취소 (부분 취소 가능). 같은 idempotencyKey 로 다시 부르면 한 번만 취소된다 */
  cancel(input: {
    paymentKey: string;
    amount: number;
    reason: string;
    idempotencyKey: string;
  }): Promise<TossPayment>;
  /** 카드 등록창에서 돌아온 authKey 로 빌링키를 받는다 (자동결제) */
  issueBillingKey(input: { authKey: string; customerKey: string }): Promise<TossBillingAuth>;
  /** 빌링키로 결제 (자동결제). 같은 idempotencyKey 는 한 번만 결제된다 */
  chargeBilling(input: {
    billingKey: string;
    customerKey: string;
    amount: number;
    orderId: string;
    orderName: string;
    idempotencyKey: string;
  }): Promise<TossPayment>;
  /** 빌링키 삭제 (구독이 끝났거나 카드를 바꿨을 때). 성공하면 빈 200 */
  deleteBillingKey(billingKey: string): Promise<void>;
}

const errorSchema = z.object({ code: z.string(), message: z.string() });

export function createTossGateway(options: {
  secretKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}): PaymentGateway {
  const base = options.baseUrl ?? "https://api.tosspayments.com";
  const doFetch = options.fetch ?? fetch;
  const auth = `Basic ${Buffer.from(`${options.secretKey}:`).toString("base64")}`;

  async function request(
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: unknown,
    idempotencyKey?: string,
  ) {
    const response = await doFetch(`${base}${path}`, {
      method,
      headers: {
        authorization: auth,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const data: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const parsed = errorSchema.safeParse(data);
      throw new GatewayError(
        parsed.success ? parsed.data.code : "UNKNOWN",
        parsed.success ? parsed.data.message : `토스 응답 ${response.status}`,
        response.status,
      );
    }
    return data;
  }
  const call = async (method: "GET" | "POST", path: string, body?: unknown, idempotencyKey?: string) =>
    paymentSchema.parse(await request(method, path, body, idempotencyKey));

  return {
    confirm: (input) =>
      call("POST", "/v1/payments/confirm", input, `confirm-${input.paymentKey}`.slice(0, 300)),
    get: (paymentKey) => call("GET", `/v1/payments/${encodeURIComponent(paymentKey)}`),
    cancel: (input) =>
      call(
        "POST",
        `/v1/payments/${encodeURIComponent(input.paymentKey)}/cancel`,
        { cancelReason: input.reason.slice(0, 200), cancelAmount: input.amount },
        input.idempotencyKey,
      ),
    issueBillingKey: async (input) =>
      billingAuthSchema.parse(await request("POST", "/v1/billing/authorizations/issue", input)),
    chargeBilling: (input) =>
      call(
        "POST",
        `/v1/billing/${encodeURIComponent(input.billingKey)}`,
        {
          customerKey: input.customerKey,
          amount: input.amount,
          orderId: input.orderId,
          orderName: input.orderName.slice(0, 100),
        },
        input.idempotencyKey,
      ),
    deleteBillingKey: async (billingKey) => {
      await request("DELETE", `/v1/billing/${encodeURIComponent(billingKey)}`);
    },
  };
}
