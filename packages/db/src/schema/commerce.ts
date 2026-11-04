// 상품 · 가격 · 주문 · 결제 · 환불 (docs/데이터모델.md 3.5 · 3.6). 금액은 원 단위 정수.
// 가격 · 할인 정책은 고치지 않고 새 버전을 만들고, 주문 항목은 그때 값을 스냅샷한다 (가격을 바꿔도 이전 주문은 그대로).
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { policyDocuments, users } from "./auth";
import { courses } from "./content";
import { entitlements } from "./learning";
import { id } from "./system";

const tz = () => timestamp({ withTimezone: true });
const createdAt = () => tz().notNull().defaultNow();
const updatedAt = () =>
  tz()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const won = () => bigint({ mode: "number" });

export const PRODUCT_TYPES = ["course", "bundle", "subscription", "extension"] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

/** 판매 단위. 단건 강의 · 연장권 (M5), 패키지 · 구독 요금제는 나중 */
export const products = pgTable("products", {
  id: id(),
  type: text({ enum: PRODUCT_TYPES }).notNull(),
  name: text().notNull(),
  status: text({ enum: ["on_sale", "stopped"] })
    .notNull()
    .default("on_sale"),
  /** 수강 기간 (일). 연장권은 늘리는 날수. 없으면 무제한 */
  accessDays: integer(),
  /** 구독만 (M6) */
  billingInterval: text({ enum: ["month", "year"] }),
  createdBy: uuid().references(() => users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** 상품에 들어 있는 과정. 연장권은 늘려 주는 과정 하나 */
export const productItems = pgTable(
  "product_items",
  {
    id: id(),
    productId: uuid()
      .notNull()
      .references(() => products.id),
    courseId: uuid()
      .notNull()
      .references(() => courses.id),
    /** 패키지 매출을 나눌 때 쓰는 각 과정 정가 (M9) */
    listPriceWeight: won(),
  },
  (t) => [uniqueIndex("product_items_key").on(t.productId, t.courseId)],
);

/** 가격 버전 (부가세 포함). 운영자만 만들고, 고치지 않는다 */
export const prices = pgTable(
  "prices",
  {
    id: id(),
    productId: uuid()
      .notNull()
      .references(() => products.id),
    amount: won().notNull(),
    effectiveFrom: tz().notNull(),
    createdBy: uuid().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("prices_product_idx").on(t.productId, t.effectiveFrom),
    check("prices_amount_check", sql`${t.amount} >= 0`),
  ],
);

/** 구독자 할인 (프리미엄 강의). 고치지 않고 새 버전 */
export const subscriberDiscountPolicies = pgTable(
  "subscriber_discount_policies",
  {
    id: id(),
    /** 0 ~ 100 (%) */
    ratePercent: integer().notNull(),
    appliesTo: text({ enum: ["premium"] })
      .notNull()
      .default("premium"),
    effectiveFrom: tz().notNull(),
    createdBy: uuid().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [check("subscriber_discount_rate_check", sql`${t.ratePercent} between 0 and 100`)],
);

export const ORDER_STATUSES = [
  "pending",
  "paid",
  "failed",
  "canceled",
  "partially_refunded",
  "refunded",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** 주문. 주문서(C-01)를 열 때 pending 으로 만들고, 서버가 토스 승인을 받으면 paid */
export const orders = pgTable(
  "orders",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    status: text({ enum: ORDER_STATUSES }).notNull().default("pending"),
    totalAmount: won().notNull(),
    /** 토스 결제창에 보이는 주문 이름 */
    orderName: text().notNull(),
    /** 결제 동의(환불 규정 포함)를 한 시각. 동의해야 결제창을 연다 */
    agreedAt: tz(),
    /** 주문서를 새로 만들어야 하는 시각 (30분, 그 사이 가격이 바뀌었을 수 있다) */
    expiresAt: tz().notNull(),
    paidAt: tz(),
    canceledAt: tz(),
    failReason: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("orders_user_idx").on(t.userId, t.createdAt)],
);

/** 주문 안의 상품 (장바구니가 없어 보통 1개). 📌 붙은 값은 주문할 때 스냅샷 */
export const orderItems = pgTable(
  "order_items",
  {
    id: id(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id),
    productId: uuid()
      .notNull()
      .references(() => products.id),
    productType: text({ enum: PRODUCT_TYPES }).notNull(),
    /** 수강권을 줄 (연장권은 늘릴) 과정. 구독 결제는 비어 있다 */
    courseId: uuid().references(() => courses.id),
    productName: text().notNull(),
    listPrice: won().notNull(),
    discountAmount: won().notNull().default(0),
    discountReason: text(),
    paidAmount: won().notNull(),
    supplyAmount: won().notNull(),
    vatAmount: won().notNull(),
    /** 수강 기간 · 늘리는 날수 (없으면 무제한) */
    accessDays: integer(),
    priceId: uuid().references(() => prices.id),
    /** 동의한 환불 규정 버전 */
    refundPolicyDocumentId: uuid().references(() => policyDocuments.id),
    /** 결제 뒤 만든 수강권 (연장권은 늘린 수강권) */
    entitlementId: uuid().references(() => entitlements.id),
    /** 연장권: 늘리기 전 · 뒤 끝나는 날, 늘어난 기간 시작 (환불 계산 · 되돌리기 근거) */
    extension: jsonb().$type<{ beforeEndsAt: string; afterEndsAt: string; periodStart: string }>(),
    createdAt: createdAt(),
  },
  (t) => [
    index("order_items_order_idx").on(t.orderId),
    check(
      "order_items_amount_check",
      sql`${t.paidAmount} = ${t.listPrice} - ${t.discountAmount} and ${t.supplyAmount} + ${t.vatAmount} = ${t.paidAmount}`,
    ),
  ],
);

export const PAYMENT_STATUSES = ["ready", "done", "canceled", "partially_canceled", "failed"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/**
 * 결제 승인. 같은 승인이 두 번 처리되지 않게 provider_payment_key 를 고유하게 한다 (새로고침 · 동시 요청).
 * 승인 요청 전에 ready 로 먼저 넣어 자리를 잡고, 토스 응답으로 done / failed.
 */
export const payments = pgTable(
  "payments",
  {
    id: id(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id),
    provider: text({ enum: ["toss"] })
      .notNull()
      .default("toss"),
    providerPaymentKey: text().notNull().unique(),
    /** 토스 키 묶음: 단건은 결제위젯 키, 자동결제는 API 개별 연동 키. 취소는 결제한 키 묶음으로만 된다 */
    keySet: text({ enum: ["widget", "billing"] })
      .notNull()
      .default("widget"),
    method: text(),
    amount: won().notNull(),
    /** 취소된 금액 합계 (부분 취소 포함) */
    canceledAmount: won().notNull().default(0),
    status: text({ enum: PAYMENT_STATUSES }).notNull().default("ready"),
    /** PG 수수료 (정산 M9, 지금은 비움) */
    feeAmount: won(),
    receiptUrl: text(),
    failCode: text(),
    failMessage: text(),
    /** 토스 응답에서 필요한 것만 (카드 번호는 토스가 가린 값) */
    raw: jsonb(),
    approvedAt: tz(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("payments_order_idx").on(t.orderId),
    // 한 주문에 성공한 결제는 하나만
    uniqueIndex("payments_order_done_key")
      .on(t.orderId)
      .where(sql`${t.status} in ('done', 'canceled', 'partially_canceled')`),
  ],
);

export const REFUND_STATUSES = ["requested", "approved", "rejected", "done", "failed"] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

/**
 * 환불. 수강생이 요청(M-04) ➔ 운영자가 승인 · 거절(AD-10) ➔ 승인하면 토스 취소 ➔ done.
 * calculation 은 core calculateRefund 결과를 그대로 (요청 때 · 처리 때 둘 다).
 */
export const refunds = pgTable(
  "refunds",
  {
    id: id(),
    orderItemId: uuid()
      .notNull()
      .references(() => orderItems.id),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    status: text({ enum: REFUND_STATUSES }).notNull().default("requested"),
    /** 요청할 때 계산 */
    calculation: jsonb().notNull(),
    /** 운영자가 처리할 때 다시 계산한 것 */
    decisionCalculation: jsonb(),
    requestedAmount: won().notNull(),
    approvedAmount: won(),
    reason: text().notNull(),
    reasonDetail: text(),
    decidedBy: uuid().references(() => users.id),
    decidedAt: tz(),
    /** 거절 사유 · 금액을 바꾼 이유 */
    decisionNote: text(),
    /** 토스 취소 거래 키 */
    providerCancelKey: text(),
    failMessage: text(),
    doneAt: tz(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("refunds_status_idx").on(t.status, t.createdAt),
    // 한 주문 항목에 진행 중이거나 끝난 환불은 하나만
    uniqueIndex("refunds_item_open_key")
      .on(t.orderItemId)
      .where(sql`${t.status} in ('requested', 'approved', 'done')`),
  ],
);

/** 토스 웹훅 받은 기록 (토스에 다시 조회해 확인한 뒤 반영) */
export const paymentWebhooks = pgTable(
  "payment_webhooks",
  {
    id: id(),
    provider: text().notNull().default("toss"),
    eventType: text().notNull(),
    paymentKey: text(),
    /** 다시 조회한 결과로 무엇을 했나 */
    result: text(),
    receivedAt: createdAt(),
  },
  (t) => [index("payment_webhooks_key_idx").on(t.paymentKey)],
);

export const SUBSCRIPTION_STATUSES = [
  "pending",
  "active",
  "past_due",
  "cancel_scheduled",
  "canceled",
  "ended",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/**
 * 구독 (데이터모델 3.7, M6). pending = 신청하고 카드 등록 · 첫 결제 전.
 * 해지 예약 = cancel_scheduled ➔ 기간 끝에 ended. 즉시 해지 · 환불 = canceled. 자동결제 실패 = past_due (1 · 3 · 7일 뒤 재시도)
 */
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    productId: uuid()
      .notNull()
      .references(() => products.id),
    status: text({ enum: SUBSCRIPTION_STATUSES }).notNull().default("pending"),
    /** 📌 신청할 때 */
    interval: text({ enum: ["month", "year"] }).notNull(),
    planName: text().notNull(),
    /** 회차마다 결제하는 금액. 가격 변경은 pending_* 를 거쳐 알리고(올림은 동의 후) 바뀐다 */
    amount: won().notNull(),
    /** 결제일 기준 (가입한 KST 날짜) */
    anchorDate: date({ mode: "string" }),
    currentCycle: integer().notNull().default(0),
    currentPeriodStart: tz(),
    currentPeriodEnd: tz(),
    /** 🔒 토스 빌링키 (AES-256-GCM, packages/core/media sealBillingKey) */
    billingKeySealed: text(),
    customerKey: text().notNull(),
    /** 결제 수단 표시 (예: 신한카드 •••• 123*) */
    cardLabel: text(),
    /** 구독 수강권 (구독 포함 강의 전체) */
    entitlementId: uuid().references(() => entitlements.id),
    /** 자동결제 동의 (다른 동의와 따로, 전자상거래법) · 구독 약관 · 환불 규정 동의 */
    autoRenewAgreedAt: tz().notNull(),
    termsAgreedAt: tz().notNull(),
    agreedIp: text(),
    refundPolicyDocumentId: uuid().references(() => policyDocuments.id),
    /** 가격 변경 대기: 새 금액 · 적용할 회차 · 동의가 필요한가 · 동의한 시각 */
    pendingAmount: won(),
    pendingFromCycle: integer(),
    pendingNeedsConsent: boolean(),
    pendingAgreedAt: tz(),
    cancelRequestedAt: tz(),
    cancelReason: text(),
    endedAt: tz(),
    endReason: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("subscriptions_user_idx").on(t.userId),
    index("subscriptions_status_idx").on(t.status, t.currentPeriodEnd),
    // 한 사람에게 살아 있는 구독은 하나만
    uniqueIndex("subscriptions_user_live_key")
      .on(t.userId)
      .where(sql`${t.status} in ('active', 'past_due', 'cancel_scheduled')`),
  ],
);

/** 회차별 결제. 결제마다 주문(orders) · 결제(payments)도 만들어 결제 내역 · 영수증 · 환불을 단건과 같이 쓴다 */
export const subscriptionCycles = pgTable(
  "subscription_cycles",
  {
    id: id(),
    subscriptionId: uuid()
      .notNull()
      .references(() => subscriptions.id),
    cycleNo: integer().notNull(),
    /** KST 결제일 */
    billingDate: date({ mode: "string" }).notNull(),
    periodStart: tz().notNull(),
    periodEnd: tz().notNull(),
    amount: won().notNull(),
    supplyAmount: won().notNull(),
    vatAmount: won().notNull(),
    status: text({ enum: ["scheduled", "paid", "failed", "refunded"] })
      .notNull()
      .default("scheduled"),
    orderId: uuid().references(() => orders.id),
    paymentId: uuid().references(() => payments.id),
    retryCount: integer().notNull().default(0),
    nextRetryAt: tz(),
    lastError: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("subscription_cycles_key").on(t.subscriptionId, t.cycleNo)],
);

export const SUBSCRIPTION_NOTICE_KINDS = [
  "started",
  "renewal",
  "price_change",
  "payment_failed",
  "cancel_scheduled",
  "ended",
] as const;

/** 법정 고지 · 안내 메일 기록 (갱신 · 가격 변경 · 결제 실패 · 해지). 같은 회차에 같은 종류는 한 번만 */
export const subscriptionNotices = pgTable(
  "subscription_notices",
  {
    id: id(),
    subscriptionId: uuid()
      .notNull()
      .references(() => subscriptions.id),
    kind: text({ enum: SUBSCRIPTION_NOTICE_KINDS }).notNull(),
    cycleNo: integer().notNull(),
    /** 가격 변경 알림의 새 금액 */
    newAmount: won(),
    sentAt: createdAt(),
    /** 가격 인상 동의 */
    agreedAt: tz(),
  },
  (t) => [uniqueIndex("subscription_notices_key").on(t.subscriptionId, t.kind, t.cycleNo)],
);
