// 상품 · 가격 · 주문 · 결제 · 환불 (docs/데이터모델.md 3.5 · 3.6). 금액은 원 단위 정수.
// 가격 · 할인 정책은 고치지 않고 새 버전을 만들고, 주문 항목은 그때 값을 스냅샷한다 (가격을 바꿔도 이전 주문은 그대로).
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
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
    /** 수강권을 줄 (연장권은 늘릴) 과정 */
    courseId: uuid()
      .notNull()
      .references(() => courses.id),
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
