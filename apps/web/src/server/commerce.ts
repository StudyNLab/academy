// 단건 결제 (docs/기술설계.md 6.1): 상품 · 가격(AD-07) ➔ 주문서(C-01) ➔ 토스 결제창 ➔ 서버 승인 ➔ 수강권 ➔ 영수증 메일.
// 돈 계산은 packages/core 만 한다. 브라우저가 보낸 금액은 믿지 않고 주문 스냅샷과 토스 응답으로만 판단한다.
import type { Quote } from "@aionit/core";
import {
  courseAccess,
  discountAt,
  endOfKstDayAfter,
  extendedEnd,
  priceAt,
  quote,
  subscriberDiscountApplies,
} from "@aionit/core";
import type { Db } from "@aionit/db";
import { and, desc, eq, gt, inArray, isNull, schema, sql } from "@aionit/db";
import type { MailJob } from "@aionit/mail";
import { currentPolicies } from "./consents";
import { userEntitlements } from "./entitlements";
import { writeAudit } from "./records";
import type { PaymentGateway, TossPayment } from "@aionit/payments";
import { GatewayError, trimPayment } from "@aionit/payments";
import type { Viewer } from "./viewer";

export class CommerceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface CommerceDeps {
  db: Db;
  /** 단건 (결제위젯 키) */
  gateway: PaymentGateway;
  /** 구독 자동결제 (API 개별 연동 키). 구독 결제의 환불 · 웹훅 조회에 쓴다 */
  billingGateway?: PaymentGateway | null;
  enqueueMail: (job: MailJob) => Promise<void>;
  /** 메일 · 돌아올 주소의 기준 (BETTER_AUTH_URL) */
  baseUrl: string;
}

/** 주문서를 새로 만들어야 하는 시간 (화면상세기획 3.1) */
export const ORDER_TTL_MS = 30 * 60_000;

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Product = typeof schema.products.$inferSelect;

// ---- 운영자: 상품 · 가격 · 구독자 할인 (AD-07) ----

async function assertSingleOnSale(tx: Pick<Db, "select">, courseId: string, type: string, except?: string) {
  const rows = await tx
    .select({ id: schema.products.id })
    .from(schema.products)
    .innerJoin(schema.productItems, eq(schema.productItems.productId, schema.products.id))
    .where(
      and(
        eq(schema.productItems.courseId, courseId),
        eq(schema.products.type, type as Product["type"]),
        eq(schema.products.status, "on_sale"),
      ),
    );
  if (rows.some((r) => r.id !== except))
    throw new CommerceError(
      400,
      "ALREADY_ON_SALE",
      type === "extension"
        ? "이 과정에는 이미 판매 중인 연장권이 있습니다. 그 상품의 가격을 바꾸거나 판매를 멈춘 뒤 만드세요."
        : "이 과정에는 이미 판매 중인 상품이 있습니다. 그 상품의 가격을 바꾸거나 판매를 멈춘 뒤 만드세요.",
    );
}

export async function createProduct(
  db: Db,
  input: {
    actorId: string;
    /** 단건 강의 · 연장권 (M5), 구독 요금제 (M6). 패키지는 나중 */
    type: "course" | "extension" | "subscription";
    /** 구독 요금제는 없다 (구독 포함 강의 전체) */
    courseId: string | null;
    /** 구독만 */
    billingInterval?: "month" | "year" | null;
    name: string;
    accessDays: number | null;
    amount: number;
    headers?: Headers | null;
  },
  now = new Date(),
): Promise<string> {
  if (input.type === "extension" && !input.accessDays)
    throw new CommerceError(400, "INVALID_DAYS", "연장권은 늘릴 날수가 있어야 합니다.");
  if (input.type === "subscription" && !input.billingInterval)
    throw new CommerceError(400, "INVALID_INTERVAL", "구독은 월간 · 연간을 골라야 합니다.");
  if (input.type !== "subscription" && !input.courseId)
    throw new CommerceError(400, "COURSE_REQUIRED", "과정을 골라 주세요.");
  return db.transaction(async (tx) => {
    if (input.type === "subscription") {
      await assertSinglePlan(tx, input.billingInterval!);
    } else {
      const [course] = await tx
        .select({ id: schema.courses.id })
        .from(schema.courses)
        .where(eq(schema.courses.id, input.courseId!));
      if (!course) throw new CommerceError(404, "COURSE_NOT_FOUND", "과정을 찾을 수 없습니다.");
      await assertSingleOnSale(tx, input.courseId!, input.type);
    }
    const [product] = await tx
      .insert(schema.products)
      .values({
        type: input.type,
        name: input.name,
        accessDays: input.type === "subscription" ? null : input.accessDays,
        billingInterval: input.type === "subscription" ? input.billingInterval : null,
        createdBy: input.actorId,
      })
      .returning();
    if (input.type !== "subscription")
      await tx.insert(schema.productItems).values({ productId: product!.id, courseId: input.courseId! });
    const [price] = await tx
      .insert(schema.prices)
      .values({ productId: product!.id, amount: input.amount, effectiveFrom: now, createdBy: input.actorId })
      .returning({ id: schema.prices.id });
    await writeAudit(tx, {
      actorId: input.actorId,
      action: "product.create",
      targetType: "product",
      targetId: product!.id,
      after: { ...input, headers: undefined, actorId: undefined, priceId: price!.id },
      headers: input.headers,
    });
    return product!.id;
  });
}

/** 판매 중인 구독 요금제는 월간 · 연간 하나씩 */
async function assertSinglePlan(tx: Pick<Db, "select">, interval: "month" | "year", except?: string) {
  const rows = await tx
    .select({ id: schema.products.id })
    .from(schema.products)
    .where(
      and(
        eq(schema.products.type, "subscription"),
        eq(schema.products.billingInterval, interval),
        eq(schema.products.status, "on_sale"),
      ),
    );
  if (rows.some((r) => r.id !== except))
    throw new CommerceError(
      400,
      "ALREADY_ON_SALE",
      `이미 판매 중인 ${interval === "month" ? "월간" : "연간"} 요금제가 있습니다. 그 요금제의 가격을 바꾸거나 판매를 멈춘 뒤 만드세요.`,
    );
}

export async function updateProduct(
  db: Db,
  input: {
    actorId: string;
    productId: string;
    name?: string;
    accessDays?: number | null;
    status?: "on_sale" | "stopped";
    headers?: Headers | null;
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ product: schema.products, courseId: schema.productItems.courseId })
      .from(schema.products)
      .leftJoin(schema.productItems, eq(schema.productItems.productId, schema.products.id))
      .where(eq(schema.products.id, input.productId));
    if (!row) throw new CommerceError(404, "NOT_FOUND", "상품을 찾을 수 없습니다.");
    if (input.status === "on_sale" && row.product.status !== "on_sale") {
      if (row.product.type === "subscription")
        await assertSinglePlan(tx, row.product.billingInterval!, row.product.id);
      else await assertSingleOnSale(tx, row.courseId!, row.product.type, row.product.id);
    }
    if (row.product.type === "extension" && input.accessDays === null)
      throw new CommerceError(400, "INVALID_DAYS", "연장권은 늘릴 날수가 있어야 합니다.");
    const change = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.accessDays !== undefined ? { accessDays: input.accessDays } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    };
    await tx.update(schema.products).set(change).where(eq(schema.products.id, input.productId));
    await writeAudit(tx, {
      actorId: input.actorId,
      action: "product.update",
      targetType: "product",
      targetId: input.productId,
      before: { name: row.product.name, accessDays: row.product.accessDays, status: row.product.status },
      after: change,
      headers: input.headers,
    });
  });
}

/** 새 가격 버전. 이미 만든 주문서 · 주문은 그때 가격 그대로 (스냅샷) */
export async function addPrice(
  db: Db,
  input: {
    actorId: string;
    productId: string;
    amount: number;
    effectiveFrom: Date;
    headers?: Headers | null;
  },
): Promise<string> {
  return db.transaction(async (tx) => {
    const [product] = await tx
      .select({ id: schema.products.id })
      .from(schema.products)
      .where(eq(schema.products.id, input.productId));
    if (!product) throw new CommerceError(404, "NOT_FOUND", "상품을 찾을 수 없습니다.");
    const [price] = await tx
      .insert(schema.prices)
      .values({
        productId: input.productId,
        amount: input.amount,
        effectiveFrom: input.effectiveFrom,
        createdBy: input.actorId,
      })
      .returning({ id: schema.prices.id });
    await writeAudit(tx, {
      actorId: input.actorId,
      action: "price.create",
      targetType: "product",
      targetId: input.productId,
      after: { priceId: price!.id, amount: input.amount, effectiveFrom: input.effectiveFrom },
      headers: input.headers,
    });
    return price!.id;
  });
}

export async function addDiscountPolicy(
  db: Db,
  input: { actorId: string; ratePercent: number; effectiveFrom: Date; headers?: Headers | null },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.subscriberDiscountPolicies)
      .values({
        ratePercent: input.ratePercent,
        effectiveFrom: input.effectiveFrom,
        createdBy: input.actorId,
      })
      .returning({ id: schema.subscriberDiscountPolicies.id });
    await writeAudit(tx, {
      actorId: input.actorId,
      action: "discount.create",
      targetType: "subscriber_discount_policy",
      targetId: row!.id,
      after: { ratePercent: input.ratePercent, effectiveFrom: input.effectiveFrom },
      headers: input.headers,
    });
  });
}

/** 운영자 상품 목록: 지금 가격 · 예약된 가격 · 가격 이력 */
export async function adminProducts(db: Db, now = new Date()) {
  const rows = await db
    .select({ product: schema.products, courseId: schema.courses.id, courseTitle: schema.courses.title })
    .from(schema.products)
    .leftJoin(schema.productItems, eq(schema.productItems.productId, schema.products.id))
    .leftJoin(schema.courses, eq(schema.courses.id, schema.productItems.courseId))
    .orderBy(schema.courses.title, schema.products.type, desc(schema.products.createdAt));
  const priceRows = rows.length
    ? await db
        .select()
        .from(schema.prices)
        .where(
          inArray(
            schema.prices.productId,
            rows.map((r) => r.product.id),
          ),
        )
        .orderBy(desc(schema.prices.effectiveFrom))
    : [];
  return rows.map((r) => {
    const history = priceRows.filter((p) => p.productId === r.product.id);
    return {
      ...r,
      current: priceAt(history, now),
      upcoming: history.filter((p) => p.effectiveFrom > now),
      history,
    };
  });
}

export async function discountPolicies(db: Db) {
  return db
    .select()
    .from(schema.subscriberDiscountPolicies)
    .orderBy(desc(schema.subscriberDiscountPolicies.effectiveFrom));
}

// ---- 공개: 강의 상세 구매 카드 (P-03) · L-05 ----

/** 구독 중인가 (구독 포함 강의 전체를 보는 수강권이 지금 있다). 구독(M6) 전에는 운영자 발급분만 */
function isSubscriber(ents: Awaited<ReturnType<typeof userEntitlements>>, now: Date): boolean {
  return ents.some(
    (e) =>
      e.scope === "subscription_catalog" &&
      !e.revokedAt &&
      e.startsAt <= now &&
      (!e.endsAt || now < e.endsAt),
  );
}

export interface Offer {
  productId: string;
  name: string;
  accessDays: number | null;
  quote: Quote;
}

async function onSaleProducts(db: Pick<Db, "select">, courseId: string) {
  const rows = await db
    .select({ product: schema.products })
    .from(schema.products)
    .innerJoin(schema.productItems, eq(schema.productItems.productId, schema.products.id))
    .where(and(eq(schema.productItems.courseId, courseId), eq(schema.products.status, "on_sale")));
  const ids = rows.map((r) => r.product.id);
  const priceRows = ids.length
    ? await db.select().from(schema.prices).where(inArray(schema.prices.productId, ids))
    : [];
  return rows.map((r) => ({
    product: r.product,
    prices: priceRows.filter((p) => p.productId === r.product.id),
  }));
}

async function pricing(
  db: Pick<Db, "select">,
  input: {
    product: Product;
    prices: (typeof schema.prices.$inferSelect)[];
    premium: boolean;
    subscriber: boolean;
  },
  now: Date,
) {
  const price = priceAt(input.prices, now);
  if (!price) return null;
  let discount: { ratePercent: number; reason: string } | null = null;
  if (
    input.product.type !== "subscription" &&
    subscriberDiscountApplies({
      productType: input.product.type,
      premium: input.premium,
      subscriber: input.subscriber,
    })
  ) {
    const policy = discountAt(await db.select().from(schema.subscriberDiscountPolicies), now);
    if (policy && policy.ratePercent > 0)
      discount = { ratePercent: policy.ratePercent, reason: `구독자 할인 ${policy.ratePercent}%` };
  }
  return { price, quote: quote(price.amount, discount) };
}

/** 이 과정의 판매 상품 (단건 · 연장권) 과 이 사람이 낼 금액 */
export async function courseOffers(
  db: Db,
  course: { id: string; inSubscription: boolean },
  viewer: Viewer | null,
  now = new Date(),
) {
  const ents = viewer ? await userEntitlements(db, viewer.userId) : [];
  const subscriber = isSubscriber(ents, now);
  const products = await onSaleProducts(db, course.id);
  const offer = async (type: "course" | "extension"): Promise<Offer | null> => {
    const found = products.find((p) => p.product.type === type);
    if (!found) return null;
    const priced = await pricing(db, { ...found, premium: !course.inSubscription, subscriber }, now);
    if (!priced) return null;
    return {
      productId: found.product.id,
      name: found.product.name,
      accessDays: found.product.accessDays,
      quote: priced.quote,
    };
  };
  // 정가로 본 구독자 할인가 (구독하지 않은 사람에게 "구독자 n원" 으로 보여 준다)
  const purchase = await offer("course");
  let subscriberPrice: Quote | null = null;
  if (purchase && !subscriber && !course.inSubscription) {
    const found = products.find((p) => p.product.type === "course")!;
    subscriberPrice = (await pricing(db, { ...found, premium: true, subscriber: true }, now))?.quote ?? null;
    if (subscriberPrice?.discountAmount === 0) subscriberPrice = null;
  }
  return { purchase, extension: await offer("extension"), subscriber, subscriberPrice };
}

/** 연장할 수강권: 이 과정의 단건 수강권 중 끝나는 날이 가장 늦은 것 (회수 안 됨). 무제한이 있으면 연장할 필요 없음 */
async function extensionBase(db: Pick<Db, "select">, userId: string, courseId: string, lock = false) {
  const query = db
    .select()
    .from(schema.entitlements)
    .where(
      and(
        eq(schema.entitlements.userId, userId),
        eq(schema.entitlements.scope, "course"),
        eq(schema.entitlements.courseId, courseId),
        isNull(schema.entitlements.revokedAt),
      ),
    );
  const rows = lock ? await query.for("update") : await query;
  if (rows.some((r) => !r.endsAt)) return { kind: "unlimited" as const };
  const latest = rows.sort((a, b) => b.endsAt!.getTime() - a.endsAt!.getTime())[0];
  return latest ? { kind: "found" as const, entitlement: latest } : { kind: "none" as const };
}

/** 지금 단건으로 볼 수 있나 (구독 수강권은 빼고: 구독자도 단건으로 사서 남겨 둘 수 있다, 데이터모델 D3) */
async function ownsCourse(
  db: Pick<Db, "select">,
  userId: string,
  course: { id: string; inSubscription: boolean },
  now: Date,
) {
  const rows = await db
    .select()
    .from(schema.entitlements)
    .where(and(eq(schema.entitlements.userId, userId), eq(schema.entitlements.scope, "course")));
  return courseAccess(rows, course, now).ok;
}

// ---- 주문서 (C-01) ----

export async function createOrder(
  db: Db,
  viewer: Viewer,
  productId: string,
  now = new Date(),
): Promise<{ orderId: string }> {
  const [row] = await db
    .select({ product: schema.products, course: schema.courses })
    .from(schema.products)
    .innerJoin(schema.productItems, eq(schema.productItems.productId, schema.products.id))
    .innerJoin(schema.courses, eq(schema.courses.id, schema.productItems.courseId))
    .where(eq(schema.products.id, productId));
  if (!row || row.course.status !== "published")
    throw new CommerceError(404, "NOT_FOUND", "상품을 찾을 수 없습니다.");
  const { product, course } = row;
  if (product.status !== "on_sale" || (product.type !== "course" && product.type !== "extension"))
    throw new CommerceError(400, "NOT_ON_SALE", "지금은 판매하지 않는 상품입니다.");

  if (product.type === "course" && (await ownsCourse(db, viewer.userId, course, now)))
    throw new CommerceError(409, "ALREADY_OWNED", "이미 수강 중인 강의입니다.");
  if (product.type === "extension") {
    const base = await extensionBase(db, viewer.userId, course.id);
    if (base.kind === "none")
      throw new CommerceError(
        400,
        "NO_BASE_ENTITLEMENT",
        "연장할 수강권이 없습니다. 강의를 먼저 구매해 주세요.",
      );
    if (base.kind === "unlimited")
      throw new CommerceError(400, "UNLIMITED", "수강 기간이 무제한이라 연장할 필요가 없습니다.");
  }

  const ents = await userEntitlements(db, viewer.userId);
  const prices = await db.select().from(schema.prices).where(eq(schema.prices.productId, product.id));
  const priced = await pricing(
    db,
    { product, prices, premium: !course.inSubscription, subscriber: isSubscriber(ents, now) },
    now,
  );
  if (!priced) throw new CommerceError(400, "NOT_ON_SALE", "지금은 판매하지 않는 상품입니다.");

  // 같은 상품의 주문서가 아직 살아 있고 금액이 같으면 그것을 쓴다 (새로고침 · 뒤로 가기로 주문이 쌓이지 않게)
  const [open] = await db
    .select({ id: schema.orders.id, total: schema.orders.totalAmount })
    .from(schema.orders)
    .innerJoin(schema.orderItems, eq(schema.orderItems.orderId, schema.orders.id))
    .where(
      and(
        eq(schema.orders.userId, viewer.userId),
        eq(schema.orders.status, "pending"),
        eq(schema.orderItems.productId, product.id),
        eq(schema.orderItems.priceId, priced.price.id),
        gt(schema.orders.expiresAt, new Date(now.getTime() + 5 * 60_000)),
      ),
    )
    .orderBy(desc(schema.orders.createdAt))
    .limit(1);
  if (open && open.total === priced.quote.paidAmount) return { orderId: open.id };

  const refundPolicy = (await currentPolicies(db, ["refund"], now)).get("refund");
  const orderName = product.type === "extension" ? `${course.title} 연장권` : course.title;
  return db.transaction(async (tx) => {
    const [order] = await tx
      .insert(schema.orders)
      .values({
        userId: viewer.userId,
        totalAmount: priced.quote.paidAmount,
        orderName: orderName.slice(0, 100),
        expiresAt: new Date(now.getTime() + ORDER_TTL_MS),
        createdAt: now,
      })
      .returning({ id: schema.orders.id });
    await tx.insert(schema.orderItems).values({
      orderId: order!.id,
      productId: product.id,
      productType: product.type,
      courseId: course.id,
      productName: product.name,
      ...priced.quote,
      accessDays: product.accessDays,
      priceId: priced.price.id,
      refundPolicyDocumentId: refundPolicy?.id ?? null,
    });
    return { orderId: order!.id };
  });
}

/** 주문 하나 (본인 것만) */
export async function loadOrder(db: Pick<Db, "select">, userId: string, orderId: string) {
  const [row] = await db
    .select({ order: schema.orders, item: schema.orderItems, course: schema.courses })
    .from(schema.orders)
    .innerJoin(schema.orderItems, eq(schema.orderItems.orderId, schema.orders.id))
    .innerJoin(schema.courses, eq(schema.courses.id, schema.orderItems.courseId))
    .where(and(eq(schema.orders.id, orderId), eq(schema.orders.userId, userId)));
  if (!row) throw new CommerceError(404, "NOT_FOUND", "주문을 찾을 수 없습니다.");
  return row;
}

/** 주문서 화면 데이터. 연장권은 늘어날 끝나는 날을 미리 보여 준다 */
export async function checkoutView(db: Db, viewer: Viewer, orderId: string, now = new Date()) {
  const row = await loadOrder(db, viewer.userId, orderId);
  const policy = row.item.refundPolicyDocumentId
    ? (
        await db
          .select()
          .from(schema.policyDocuments)
          .where(eq(schema.policyDocuments.id, row.item.refundPolicyDocumentId))
      )[0]
    : undefined;
  let accessUntil: Date | null = null;
  if (row.item.productType === "extension") {
    const base = await extensionBase(db, viewer.userId, row.item.courseId!);
    accessUntil =
      base.kind === "found" ? extendedEnd(base.entitlement.endsAt, now, row.item.accessDays!) : null;
  } else if (row.item.accessDays) {
    accessUntil = endOfKstDayAfter(now, row.item.accessDays);
  }
  return {
    ...row,
    expired: row.order.status === "pending" && row.order.expiresAt <= now,
    refundPolicy: policy ?? null,
    accessUntil,
  };
}

/** 토스 고객 키 (결제위젯 · 자동결제 공통) */
export { tossCustomerKey } from "@aionit/payments";

/**
 * 결제 동의 (주문 내용 + 환불 규정). 동의를 기록하고 결제창에 넘길 값을 돌려준다.
 * 금액은 이 주문 스냅샷의 값 그대로 — 화면이 보낸 값은 쓰지 않는다.
 */
export async function agreeToOrder(
  db: Db,
  viewer: Viewer,
  orderId: string,
  input: { baseUrl: string; ip: string | null },
  now = new Date(),
) {
  const row = await loadOrder(db, viewer.userId, orderId);
  if (row.order.status !== "pending")
    throw new CommerceError(409, "ORDER_CLOSED", "이미 끝난 주문입니다. 결제 내역을 확인해 주세요.");
  if (row.order.expiresAt <= now)
    throw new CommerceError(
      409,
      "ORDER_EXPIRED",
      "주문서를 연 지 30분이 지났습니다. 주문서를 새로 만듭니다.",
    );
  await db.transaction(async (tx) => {
    await tx.update(schema.orders).set({ agreedAt: now }).where(eq(schema.orders.id, orderId));
    if (row.item.refundPolicyDocumentId)
      await tx.insert(schema.userConsents).values({
        userId: viewer.userId,
        policyDocumentId: row.item.refundPolicyDocumentId,
        agreed: true,
        ip: input.ip,
      });
  });
  return {
    orderId: row.order.id,
    orderName: row.order.orderName,
    amount: row.order.totalAmount,
    successUrl: `${input.baseUrl}/checkout/${row.order.id}/success`,
    failUrl: `${input.baseUrl}/checkout/${row.order.id}/fail`,
  };
}

// ---- 승인 (토스 결제창에서 돌아온 뒤) ----

export interface ConfirmResult {
  orderId: string;
  courseSlug: string;
  courseTitle: string;
  productType: string;
  paidAmount: number;
  accessUntil: Date | null;
}

async function resultOf(db: Pick<Db, "select">, userId: string, orderId: string): Promise<ConfirmResult> {
  const row = await loadOrder(db, userId, orderId);
  const [ent] = row.item.entitlementId
    ? await db.select().from(schema.entitlements).where(eq(schema.entitlements.id, row.item.entitlementId))
    : [];
  return {
    orderId,
    courseSlug: row.course.slug,
    courseTitle: row.course.title,
    productType: row.item.productType,
    paidAmount: row.item.paidAmount,
    accessUntil: ent?.endsAt ?? null,
  };
}

async function recordFailedAttempt(
  db: Db,
  input: { orderId: string; paymentKey: string; amount: number; code: string; message: string },
) {
  await db
    .insert(schema.payments)
    .values({
      orderId: input.orderId,
      providerPaymentKey: input.paymentKey,
      amount: input.amount,
      status: "failed",
      failCode: input.code,
      failMessage: input.message.slice(0, 500),
    })
    .onConflictDoNothing();
  await db
    .update(schema.orders)
    .set({ failReason: `${input.code}: ${input.message}`.slice(0, 500) })
    .where(and(eq(schema.orders.id, input.orderId), eq(schema.orders.status, "pending")));
}

/**
 * 결제 승인 (기술설계 6.1):
 *   ① 주문 금액과 amount 대조 (위조면 토스를 부르지 않는다)
 *   ② payments 에 paymentKey 로 자리를 먼저 잡는다 (고유 키 ➔ 같은 승인이 동시에 두 번 와도 하나만 진행)
 *   ③ 토스 승인 API (비밀 키) ➔ 응답의 금액 · 주문 번호를 다시 대조
 *   ④ payments(done) · orders(paid) · 수강권을 한 트랜잭션으로 ➔ ⑤ 영수증 메일
 */
export async function confirmPayment(
  deps: CommerceDeps,
  viewer: Viewer,
  input: { paymentKey: string; orderId: string; amount: number },
  now = new Date(),
): Promise<ConfirmResult> {
  const { db, gateway } = deps;
  const row = await loadOrder(db, viewer.userId, input.orderId);
  const { order, item, course } = row;

  if (order.status === "paid" || order.status === "partially_refunded" || order.status === "refunded") {
    const [same] = await db
      .select({ id: schema.payments.id })
      .from(schema.payments)
      .where(
        and(
          eq(schema.payments.orderId, order.id),
          eq(schema.payments.providerPaymentKey, input.paymentKey),
          eq(schema.payments.status, "done"),
        ),
      );
    // 새로고침 · 두 번 누름: 이미 승인한 결제면 결과만 다시 보여 준다
    if (same) return resultOf(db, viewer.userId, order.id);
    throw new CommerceError(409, "ALREADY_PAID", "이미 결제가 끝난 주문입니다.");
  }
  if (order.status !== "pending")
    throw new CommerceError(409, "ORDER_CLOSED", "이미 끝난 주문입니다. 주문서를 새로 만들어 주세요.");

  // ① 금액 위조: 결제창에서 돌아온 금액이 주문 금액과 다르면 승인하지 않는다
  if (input.amount !== order.totalAmount) {
    await recordFailedAttempt(db, {
      orderId: order.id,
      paymentKey: input.paymentKey,
      amount: input.amount,
      code: "AMOUNT_MISMATCH",
      message: `주문 금액 ${order.totalAmount} 와 결제 금액 ${input.amount} 이 다름`,
    });
    throw new CommerceError(
      400,
      "AMOUNT_MISMATCH",
      "결제 금액이 주문 금액과 달라 결제를 진행하지 않았습니다.",
    );
  }
  if (!order.agreedAt)
    throw new CommerceError(400, "NOT_AGREED", "주문 내용과 환불 규정에 동의해야 결제할 수 있습니다.");
  await assertFulfillable(db, viewer.userId, item, course, now);

  // ② 자리 잡기
  const [claimed] = await db
    .insert(schema.payments)
    .values({
      orderId: order.id,
      providerPaymentKey: input.paymentKey,
      amount: order.totalAmount,
      status: "ready",
    })
    .onConflictDoNothing()
    .returning({ id: schema.payments.id });
  if (!claimed) {
    const [existing] = await db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.providerPaymentKey, input.paymentKey));
    if (existing?.status === "done" && existing.orderId === order.id)
      return resultOf(db, viewer.userId, order.id);
    if (existing?.status === "ready")
      throw new CommerceError(
        409,
        "PAYMENT_IN_PROGRESS",
        "결제를 처리하고 있습니다. 잠시 뒤 결제 내역을 확인해 주세요.",
      );
    throw new CommerceError(400, "PAYMENT_FAILED", existing?.failMessage ?? "결제를 승인하지 못했습니다.");
  }

  // ③ 토스 승인
  let payment: TossPayment;
  try {
    payment = await gateway.confirm({
      paymentKey: input.paymentKey,
      orderId: order.id,
      amount: order.totalAmount,
    });
  } catch (error) {
    if (error instanceof GatewayError) {
      await markPaymentFailed(db, claimed.id, order.id, error.code, error.message);
      throw new CommerceError(400, "PAYMENT_FAILED", `결제를 승인하지 못했습니다: ${error.message}`);
    }
    // 응답을 못 받음 (시간 초과 등): 승인됐는지 토스에 다시 물어본다
    payment = await gateway.get(input.paymentKey).catch(async () => {
      throw new CommerceError(
        503,
        "PAYMENT_UNKNOWN",
        "결제 결과를 아직 확인하지 못했습니다. 잠시 뒤 결제 내역을 확인해 주세요.",
      );
    });
    if (payment.status !== "DONE") {
      await markPaymentFailed(db, claimed.id, order.id, "CONFIRM_ERROR", "승인 응답을 받지 못함");
      throw new CommerceError(400, "PAYMENT_FAILED", "결제를 승인하지 못했습니다. 다시 시도해 주세요.");
    }
  }
  // 토스 응답도 다시 대조: 다르면 받은 돈을 바로 돌려준다
  if (
    payment.status !== "DONE" ||
    payment.totalAmount !== order.totalAmount ||
    payment.orderId !== order.id
  ) {
    await safeCancel(gateway, payment, "결제 확인 불일치 (자동 취소)", `mismatch-${claimed.id}`);
    await markPaymentFailed(
      db,
      claimed.id,
      order.id,
      "RESPONSE_MISMATCH",
      JSON.stringify(trimPayment(payment)),
    );
    throw new CommerceError(400, "AMOUNT_MISMATCH", "결제 정보가 주문과 달라 결제를 취소했습니다.");
  }

  // ④ 기록 · 수강권
  try {
    await finishPaid(db, { paymentId: claimed.id, payment, now });
  } catch (error) {
    // 수강권을 줄 수 없게 됐다 (그 사이 다른 주문으로 샀다 등): 받은 돈을 돌려준다
    console.error(`[commerce] 승인 뒤 처리 실패 ${order.id}`, error);
    await safeCancel(gateway, payment, "수강권 처리 실패 (자동 취소)", `fulfill-${claimed.id}`);
    await markPaymentFailed(
      db,
      claimed.id,
      order.id,
      "FULFILL_FAILED",
      error instanceof Error ? error.message : "",
    );
    if (error instanceof CommerceError) throw error;
    throw new CommerceError(
      500,
      "FULFILL_FAILED",
      "수강권을 만들지 못해 결제를 취소했습니다. 1:1 문의로 알려 주세요.",
    );
  }

  // ⑤ 영수증 메일 (실패해도 결제는 끝났다. 메일 작업이 다시 시도한다)
  const result = await resultOf(db, viewer.userId, order.id);
  await deps
    .enqueueMail({
      template: "payment-receipt",
      to: viewer.email,
      userId: viewer.userId,
      productName: item.productName,
      listPrice: item.listPrice,
      discountAmount: item.discountAmount,
      paidAmount: item.paidAmount,
      supplyAmount: item.supplyAmount,
      vatAmount: item.vatAmount,
      paidAt: now.toISOString(),
      accessUntil: result.accessUntil?.toISOString() ?? null,
      receiptUrl: payment.receipt?.url ?? null,
      historyUrl: `${deps.baseUrl}/my/payments`,
    })
    .catch((error: unknown) => console.error(`[commerce] 영수증 메일 넣기 실패 ${order.id}`, error));
  return result;
}

/** 수강권을 줄 수 있는 상태인가 (승인 전에 본다: 돈을 받은 뒤에 거절하지 않게) */
async function assertFulfillable(
  db: Pick<Db, "select">,
  userId: string,
  item: typeof schema.orderItems.$inferSelect,
  course: { id: string; inSubscription: boolean },
  now: Date,
) {
  if (item.productType === "course" && (await ownsCourse(db, userId, course, now)))
    throw new CommerceError(
      409,
      "ALREADY_OWNED",
      "이미 수강 중인 강의입니다. 이 주문은 결제하지 않았습니다.",
    );
  if (item.productType === "extension") {
    const base = await extensionBase(db, userId, item.courseId!);
    if (base.kind !== "found")
      throw new CommerceError(
        400,
        "NO_BASE_ENTITLEMENT",
        "연장할 수강권이 없습니다. 이 주문은 결제하지 않았습니다.",
      );
  }
}

async function markPaymentFailed(db: Db, paymentId: string, orderId: string, code: string, message: string) {
  await db
    .update(schema.payments)
    .set({ status: "failed", failCode: code, failMessage: message.slice(0, 500) })
    .where(eq(schema.payments.id, paymentId));
  await db
    .update(schema.orders)
    .set({ failReason: `${code}: ${message}`.slice(0, 500) })
    .where(and(eq(schema.orders.id, orderId), eq(schema.orders.status, "pending")));
}

async function safeCancel(gateway: PaymentGateway, payment: TossPayment, reason: string, key: string) {
  if (payment.status !== "DONE" || payment.balanceAmount <= 0) return;
  await gateway
    .cancel({ paymentKey: payment.paymentKey, amount: payment.balanceAmount, reason, idempotencyKey: key })
    .catch((error: unknown) => console.error(`[commerce] 자동 취소 실패 ${payment.paymentKey}`, error));
}

/** payments(done) · orders(paid) · 수강권 (한 트랜잭션). 웹훅으로 늦게 맞출 때도 쓴다 */
export async function finishPaid(
  db: Db,
  input: { paymentId: string; payment: TossPayment; now: Date },
): Promise<void> {
  const { payment, now } = input;
  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(schema.payments)
      .set({
        status: "done",
        method: payment.method ?? null,
        receiptUrl: payment.receipt?.url ?? null,
        approvedAt: payment.approvedAt ? new Date(payment.approvedAt) : now,
        raw: trimPayment(payment),
      })
      .where(and(eq(schema.payments.id, input.paymentId), eq(schema.payments.status, "ready")))
      .returning({ orderId: schema.payments.orderId });
    if (!updated) throw new CommerceError(409, "PAYMENT_IN_PROGRESS", "이미 처리한 결제입니다.");
    const [order] = await tx
      .update(schema.orders)
      .set({ status: "paid", paidAt: now, failReason: null })
      .where(and(eq(schema.orders.id, updated.orderId), eq(schema.orders.status, "pending")))
      .returning();
    if (!order) throw new CommerceError(409, "ORDER_CLOSED", "이미 끝난 주문입니다.");
    const items = await tx.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, order.id));
    for (const item of items) await fulfill(tx, order.userId, item, now);
  });
}

async function fulfill(tx: Tx, userId: string, item: typeof schema.orderItems.$inferSelect, now: Date) {
  if (item.productType === "extension") {
    const base = await extensionBase(tx, userId, item.courseId!, true);
    if (base.kind !== "found")
      throw new CommerceError(400, "NO_BASE_ENTITLEMENT", "연장할 수강권이 없습니다.");
    const before = base.entitlement.endsAt!;
    const after = extendedEnd(before, now, item.accessDays!);
    await tx
      .update(schema.entitlements)
      .set({ endsAt: after, remindedD30At: null, remindedD7At: null })
      .where(eq(schema.entitlements.id, base.entitlement.id));
    await tx
      .update(schema.orderItems)
      .set({
        entitlementId: base.entitlement.id,
        extension: {
          beforeEndsAt: before.toISOString(),
          afterEndsAt: after.toISOString(),
          periodStart: (before > now ? before : now).toISOString(),
        },
      })
      .where(eq(schema.orderItems.id, item.id));
    return;
  }
  const [course] = await tx
    .select({ id: schema.courses.id, inSubscription: schema.courses.inSubscription })
    .from(schema.courses)
    .where(eq(schema.courses.id, item.courseId!));
  // 같은 사람의 동시 결제가 겹쳐도 수강권이 두 개 생기지 않게 회원 단위로 잠근다
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`purchase:${userId}:${item.courseId}`}))`);
  if (await ownsCourse(tx, userId, course!, now))
    throw new CommerceError(409, "ALREADY_OWNED", "이미 수강 중인 강의입니다.");
  const [ent] = await tx
    .insert(schema.entitlements)
    .values({
      userId,
      scope: "course",
      courseId: item.courseId!,
      sourceType: "purchase",
      sourceId: item.id,
      startsAt: now,
      endsAt: item.accessDays ? endOfKstDayAfter(now, item.accessDays) : null,
    })
    .returning({ id: schema.entitlements.id });
  await tx.update(schema.orderItems).set({ entitlementId: ent!.id }).where(eq(schema.orderItems.id, item.id));
}

// ---- 결제 내역 (M-04) ----

export async function myOrders(db: Db, userId: string) {
  const rows = await db
    .select({ order: schema.orders, item: schema.orderItems, course: schema.courses })
    .from(schema.orders)
    .innerJoin(schema.orderItems, eq(schema.orderItems.orderId, schema.orders.id))
    .leftJoin(schema.courses, eq(schema.courses.id, schema.orderItems.courseId))
    .where(
      and(
        eq(schema.orders.userId, userId),
        inArray(schema.orders.status, ["paid", "partially_refunded", "refunded"]),
      ),
    )
    .orderBy(desc(schema.orders.paidAt));
  if (rows.length === 0) return [];
  const orderIds = rows.map((r) => r.order.id);
  const [paymentRows, refundRows] = await Promise.all([
    db
      .select()
      .from(schema.payments)
      .where(
        and(
          inArray(schema.payments.orderId, orderIds),
          inArray(schema.payments.status, ["done", "canceled", "partially_canceled"]),
        ),
      ),
    db
      .select()
      .from(schema.refunds)
      .where(
        inArray(
          schema.refunds.orderItemId,
          rows.map((r) => r.item.id),
        ),
      )
      .orderBy(desc(schema.refunds.createdAt)),
  ]);
  return rows.map((r) => ({
    ...r,
    payment: paymentRows.find((p) => p.orderId === r.order.id) ?? null,
    refunds: refundRows.filter((f) => f.orderItemId === r.item.id),
  }));
}
