// 환불 (docs/기술설계.md 6.3): 수강생 요청(M-04) ➔ 운영자 승인 · 거절(AD-10) ➔ 토스 취소(부분 취소) ➔ 수강권 끝 ➔ 메일.
// 계산은 packages/core calculateRefund 하나만 쓰고, 근거를 refunds.calculation 에 그대로 남긴다.
import type { RefundCalculation, RefundInput } from "@aionit/core";
import { calculateRefund, revertedEnd } from "@aionit/core";
import type { Db } from "@aionit/db";
import { and, asc, desc, eq, inArray, isNotNull, schema } from "@aionit/db";
import type { CommerceDeps } from "./commerce";
import { CommerceError, finishPaid } from "./commerce";
import { writeAudit } from "./records";
import type { PaymentGateway, TossPayment } from "./toss";
import { GatewayError, trimPayment } from "./toss";
import type { Viewer } from "./viewer";

export const REFUND_REASONS = [
  "강의 내용이 기대와 달라요",
  "시간이 없어 들을 수 없어요",
  "실습 환경을 준비하기 어려워요",
  "실수로 결제했어요",
  "기타",
] as const;

type Item = typeof schema.orderItems.$inferSelect;
type Order = typeof schema.orders.$inferSelect;

/** 이 주문 항목의 환불 계산에 필요한 값 (진도 · 첫 이용 · 연장 기간) */
async function refundInput(db: Pick<Db, "select">, order: Order, item: Item): Promise<RefundInput> {
  if (!order.paidAt) throw new CommerceError(400, "NOT_PAID", "결제가 끝난 주문만 환불할 수 있습니다.");
  if (item.productType === "extension") {
    if (!item.extension) throw new CommerceError(400, "NOT_FULFILLED", "연장 기록이 없습니다.");
    return {
      kind: "extension",
      paidAmount: item.paidAmount,
      paidAt: order.paidAt,
      accessDays: item.accessDays!,
      periodStart: new Date(item.extension.periodStart),
    };
  }
  const [ent] = item.entitlementId
    ? await db.select().from(schema.entitlements).where(eq(schema.entitlements.id, item.entitlementId))
    : [];
  // 진도율: 학습 화면과 같은 기준 (지금 공개 버전의 챕터 중 완료한 것)
  const [course] = await db
    .select({ versionId: schema.courses.publishedVersionId })
    .from(schema.courses)
    .where(eq(schema.courses.id, item.courseId));
  const keys = course?.versionId
    ? (
        await db
          .select({ key: schema.chapters.chapterKey })
          .from(schema.chapters)
          .where(eq(schema.chapters.courseVersionId, course.versionId))
      ).map((c) => c.key)
    : [];
  const done = keys.length
    ? await db
        .select({ key: schema.chapterProgress.chapterKey })
        .from(schema.chapterProgress)
        .where(
          and(
            eq(schema.chapterProgress.userId, order.userId),
            eq(schema.chapterProgress.courseId, item.courseId),
            inArray(schema.chapterProgress.chapterKey, keys),
            isNotNull(schema.chapterProgress.completedAt),
          ),
        )
    : [];
  return {
    kind: "course",
    paidAmount: item.paidAmount,
    paidAt: order.paidAt,
    accessDays: item.accessDays,
    firstUsedAt: ent?.firstUsedAt ?? null,
    chaptersDone: done.length,
    chaptersTotal: keys.length,
  };
}

async function loadItem(db: Pick<Db, "select">, itemId: string) {
  const [row] = await db
    .select({ item: schema.orderItems, order: schema.orders, course: schema.courses })
    .from(schema.orderItems)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.orderItems.orderId))
    .innerJoin(schema.courses, eq(schema.courses.id, schema.orderItems.courseId))
    .where(eq(schema.orderItems.id, itemId));
  return row ?? null;
}

export type RefundQuote =
  | { ok: true; calculation: RefundCalculation }
  | { ok: false; code: string; message: string; calculation?: RefundCalculation };

/** 환불 요청 화면 (예상 환불액). 본인 주문만 */
export async function refundQuote(db: Db, userId: string, itemId: string, now = new Date()) {
  const row = await loadItem(db, itemId);
  if (!row || row.order.userId !== userId)
    throw new CommerceError(404, "NOT_FOUND", "주문을 찾을 수 없습니다.");
  const open = await db
    .select()
    .from(schema.refunds)
    .where(eq(schema.refunds.orderItemId, itemId))
    .orderBy(desc(schema.refunds.createdAt));
  let quote: RefundQuote;
  if (row.order.status !== "paid") {
    quote = { ok: false, code: "NOT_REFUNDABLE", message: "이미 환불했거나 결제가 끝나지 않은 주문입니다." };
  } else if (open.some((r) => r.status === "requested" || r.status === "approved")) {
    quote = {
      ok: false,
      code: "ALREADY_REQUESTED",
      message: "이미 환불을 요청했습니다. 처리되면 메일로 알려 드립니다.",
    };
  } else {
    const calculation = calculateRefund(await refundInput(db, row.order, row.item), now);
    quote =
      calculation.amount > 0
        ? { ok: true, calculation }
        : {
            ok: false,
            code: "NO_REFUND",
            message:
              calculation.basis === "progress"
                ? `진도율 ${calculation.progressPercent}% 로 1/2 이상이라 환불 규정상 환불되지 않습니다.`
                : `수강 기간의 ${calculation.elapsedPercent}% 가 지나 환불 규정상 환불되지 않습니다.`,
            calculation,
          };
  }
  return { ...row, refunds: open, quote };
}

export async function requestRefund(
  deps: Pick<CommerceDeps, "db">,
  viewer: Viewer,
  input: { itemId: string; reason: string; detail?: string | null },
  now = new Date(),
): Promise<string> {
  const { db } = deps;
  const view = await refundQuote(db, viewer.userId, input.itemId, now);
  if (!view.quote.ok) throw new CommerceError(400, view.quote.code, view.quote.message);
  const [row] = await db
    .insert(schema.refunds)
    .values({
      orderItemId: input.itemId,
      userId: viewer.userId,
      calculation: view.quote.calculation,
      requestedAmount: view.quote.calculation.amount,
      reason: input.reason,
      reasonDetail: input.detail ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: schema.refunds.id });
  if (!row) throw new CommerceError(409, "ALREADY_REQUESTED", "이미 환불을 요청했습니다.");
  return row.id;
}

/** 수강생이 요청을 거둔다 (운영자가 처리하기 전만) */
export async function withdrawRefundRequest(db: Db, viewer: Viewer, refundId: string): Promise<void> {
  const [row] = await db
    .update(schema.refunds)
    .set({ status: "rejected", decisionNote: "수강생이 요청을 거둠", decidedAt: new Date() })
    .where(
      and(
        eq(schema.refunds.id, refundId),
        eq(schema.refunds.userId, viewer.userId),
        eq(schema.refunds.status, "requested"),
      ),
    )
    .returning({ id: schema.refunds.id });
  if (!row) throw new CommerceError(404, "NOT_FOUND", "거둘 수 있는 환불 요청이 없습니다.");
}

// ---- 운영자 (AD-10) ----

export async function adminRefunds(db: Db, status: "open" | "all" = "open") {
  return db
    .select({
      refund: schema.refunds,
      item: schema.orderItems,
      order: schema.orders,
      nickname: schema.users.nickname,
    })
    .from(schema.refunds)
    .innerJoin(schema.orderItems, eq(schema.orderItems.id, schema.refunds.orderItemId))
    .innerJoin(schema.orders, eq(schema.orders.id, schema.orderItems.orderId))
    .innerJoin(schema.users, eq(schema.users.id, schema.refunds.userId))
    .where(status === "open" ? inArray(schema.refunds.status, ["requested", "approved"]) : undefined)
    .orderBy(status === "open" ? asc(schema.refunds.createdAt) : desc(schema.refunds.createdAt))
    .limit(200);
}

/** 운영자 처리 화면: 요청 때 계산과 지금 다시 계산한 값을 함께 */
export async function adminRefundDetail(db: Db, refundId: string, now = new Date()) {
  const [refund] = await db.select().from(schema.refunds).where(eq(schema.refunds.id, refundId));
  if (!refund) return null;
  const row = (await loadItem(db, refund.orderItemId))!;
  const [payment] = await db
    .select()
    .from(schema.payments)
    .where(
      and(
        eq(schema.payments.orderId, row.order.id),
        inArray(schema.payments.status, ["done", "partially_canceled", "canceled"]),
      ),
    );
  const [user] = await db
    .select({ nickname: schema.users.nickname, id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.id, refund.userId));
  const current =
    refund.status === "requested" ? calculateRefund(await refundInput(db, row.order, row.item), now) : null;
  return { refund, ...row, payment: payment ?? null, user: user ?? null, current };
}

/**
 * 승인 ➔ 토스 취소. 상태를 requested ➔ approved 로 먼저 바꿔 자리를 잡는다 (두 운영자가 동시에 눌러도 한 번만 취소).
 * 토스가 거절하면 requested 로 되돌리고 이유를 남긴다 (다시 처리할 수 있게).
 */
export async function approveRefund(
  deps: CommerceDeps,
  input: {
    actorId: string;
    refundId: string;
    amount?: number | null;
    note?: string | null;
    headers?: Headers | null;
  },
  now = new Date(),
): Promise<void> {
  const { db, gateway } = deps;
  const detail = await adminRefundDetail(db, input.refundId, now);
  if (!detail) throw new CommerceError(404, "NOT_FOUND", "환불 요청을 찾을 수 없습니다.");
  if (detail.refund.status !== "requested")
    throw new CommerceError(409, "ALREADY_DECIDED", "이미 처리한 환불 요청입니다.");
  if (!detail.payment) throw new CommerceError(400, "NO_PAYMENT", "결제 기록이 없습니다.");
  // 금액 기준은 요청한 날의 계산 (처리가 늦어져 수강생이 손해 보지 않게). 지금 다시 계산한 값은 근거로 함께 남긴다
  const requested = detail.refund.calculation as RefundCalculation;
  const calc = detail.current!;
  const balance = detail.payment.amount - detail.payment.canceledAmount;
  const amount = input.amount ?? detail.refund.requestedAmount;
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > Math.min(balance, detail.item.paidAmount))
    throw new CommerceError(
      400,
      "INVALID_AMOUNT",
      `환불 금액은 1원 이상 ${Math.min(balance, detail.item.paidAmount).toLocaleString("ko-KR")}원 이하여야 합니다.`,
    );
  if (amount !== detail.refund.requestedAmount && !input.note?.trim())
    throw new CommerceError(
      400,
      "NOTE_REQUIRED",
      "규정 계산액과 다른 금액으로 환불하려면 이유를 적어 주세요.",
    );

  const [claimed] = await db
    .update(schema.refunds)
    .set({
      status: "approved",
      approvedAmount: amount,
      decisionCalculation: calc,
      decidedBy: input.actorId,
      decidedAt: now,
      decisionNote: input.note?.trim() || null,
      failMessage: null,
    })
    .where(and(eq(schema.refunds.id, input.refundId), eq(schema.refunds.status, "requested")))
    .returning();
  if (!claimed) throw new CommerceError(409, "ALREADY_DECIDED", "이미 처리한 환불 요청입니다.");

  let payment: TossPayment;
  try {
    payment = await gateway.cancel({
      paymentKey: detail.payment.providerPaymentKey,
      amount,
      reason: `환불: ${detail.refund.reason}`,
      idempotencyKey: `refund-${claimed.id}`,
    });
  } catch (error) {
    const message = error instanceof GatewayError ? `${error.code}: ${error.message}` : String(error);
    await db
      .update(schema.refunds)
      .set({ status: "requested", failMessage: message.slice(0, 500) })
      .where(eq(schema.refunds.id, claimed.id));
    throw new CommerceError(502, "CANCEL_FAILED", `토스 취소에 실패했습니다: ${message}`);
  }

  await applyCancel(db, { payment, paymentId: detail.payment.id, refundId: claimed.id, now });
  await writeAudit(db, {
    actorId: input.actorId,
    action: "refund.approve",
    targetType: "refund",
    targetId: claimed.id,
    before: { requestedAmount: detail.refund.requestedAmount },
    after: { amount, tier: requested.tier, currentTier: calc.tier, note: input.note ?? null },
    headers: input.headers,
  });
  const [user] = await db
    .select({ email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.id, detail.refund.userId));
  if (user)
    await deps
      .enqueueMail({
        template: "refund-done",
        to: user.email,
        userId: detail.refund.userId,
        productName: detail.item.productName,
        amount,
        historyUrl: `${deps.baseUrl}/my/payments`,
      })
      .catch((error: unknown) => console.error(`[refund] 메일 넣기 실패 ${claimed.id}`, error));
}

/**
 * 토스에서 취소된 결과를 우리 기록에 맞춘다 (운영자 승인 · 웹훅 공통).
 * 결제 · 주문 상태, 환불 done, 수강권 끝 (연장권은 늘린 날을 거둔다).
 */
async function applyCancel(
  db: Db,
  input: { payment: TossPayment; paymentId: string; refundId: string; now: Date },
): Promise<void> {
  const { payment, now } = input;
  const canceledTotal = (payment.cancels ?? []).reduce((n, c) => n + c.cancelAmount, 0);
  const lastCancel = payment.cancels?.at(-1);
  await db.transaction(async (tx) => {
    const [refund] = await tx
      .update(schema.refunds)
      .set({ status: "done", doneAt: now, providerCancelKey: lastCancel?.transactionKey ?? null })
      .where(eq(schema.refunds.id, input.refundId))
      .returning();
    const full = payment.balanceAmount === 0;
    const [pay] = await tx
      .update(schema.payments)
      .set({
        status: full ? "canceled" : "partially_canceled",
        canceledAmount: canceledTotal,
        raw: trimPayment(payment),
      })
      .where(eq(schema.payments.id, input.paymentId))
      .returning({ orderId: schema.payments.orderId });
    await tx
      .update(schema.orders)
      .set({ status: full ? "refunded" : "partially_refunded" })
      .where(eq(schema.orders.id, pay!.orderId));
    const [item] = await tx
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.id, refund!.orderItemId));
    if (!item?.entitlementId) return;
    if (item.productType === "extension") {
      const [ent] = await tx
        .select()
        .from(schema.entitlements)
        .where(eq(schema.entitlements.id, item.entitlementId))
        .for("update");
      if (ent?.endsAt && !ent.revokedAt)
        await tx
          .update(schema.entitlements)
          .set({ endsAt: revertedEnd(ent.endsAt, item.accessDays!, now) })
          .where(eq(schema.entitlements.id, ent.id));
    } else {
      // 환불되면 이 강의의 수강권이 끝난다 (진도는 남긴다)
      await tx
        .update(schema.entitlements)
        .set({ revokedAt: now, revokeReason: "환불" })
        .where(and(eq(schema.entitlements.id, item.entitlementId)));
    }
  });
}

export async function rejectRefund(
  deps: CommerceDeps,
  input: { actorId: string; refundId: string; note: string; headers?: Headers | null },
  now = new Date(),
): Promise<void> {
  const { db } = deps;
  const [row] = await db
    .update(schema.refunds)
    .set({ status: "rejected", decidedBy: input.actorId, decidedAt: now, decisionNote: input.note })
    .where(and(eq(schema.refunds.id, input.refundId), eq(schema.refunds.status, "requested")))
    .returning();
  if (!row) throw new CommerceError(409, "ALREADY_DECIDED", "이미 처리한 환불 요청입니다.");
  await writeAudit(db, {
    actorId: input.actorId,
    action: "refund.reject",
    targetType: "refund",
    targetId: row.id,
    after: { note: input.note },
    headers: input.headers,
  });
  const found = await loadItem(db, row.orderItemId);
  const [user] = await db
    .select({ email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.id, row.userId));
  if (user && found)
    await deps
      .enqueueMail({
        template: "refund-rejected",
        to: user.email,
        userId: row.userId,
        productName: found.item.productName,
        note: input.note,
        historyUrl: `${deps.baseUrl}/my/payments`,
      })
      .catch((error: unknown) => console.error(`[refund] 메일 넣기 실패 ${row.id}`, error));
}

// ---- 토스 웹훅 ----

/**
 * 웹훅은 내용을 믿지 않고 paymentKey 로 토스에 다시 조회한 결과로만 맞춘다 (기술설계 6.1).
 *   - 승인은 됐는데 우리 기록이 ready 로 남음 (승인 응답 뒤 서버가 멈춤) ➔ 결제 완료 처리 · 수강권
 *   - 토스 상점 관리자에서 직접 취소 ➔ 환불 기록(done) · 수강권 끝
 *   - 결제창에서 끝나지 않음 (ABORTED · EXPIRED) ➔ 실패
 */
export async function handleTossWebhook(
  deps: Pick<CommerceDeps, "db" | "gateway">,
  body: { eventType: string; paymentKey: string | null },
  now = new Date(),
): Promise<string> {
  const { db, gateway } = deps;
  const result = await reconcile(db, gateway, body, now).catch((error: unknown) => {
    console.error("[webhook] 처리 실패", error);
    return `error: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300);
  });
  await db
    .insert(schema.paymentWebhooks)
    .values({ eventType: body.eventType.slice(0, 64), paymentKey: body.paymentKey, result });
  return result;
}

async function reconcile(
  db: Db,
  gateway: PaymentGateway,
  body: { eventType: string; paymentKey: string | null },
  now: Date,
): Promise<string> {
  if (body.eventType !== "PAYMENT_STATUS_CHANGED" || !body.paymentKey) return "ignored";
  const [ours] = await db
    .select()
    .from(schema.payments)
    .where(eq(schema.payments.providerPaymentKey, body.paymentKey));
  if (!ours) return "unknown payment";
  const payment = await gateway.get(body.paymentKey);
  if (payment.orderId !== ours.orderId) return "order mismatch";

  if (ours.status === "ready") {
    if (payment.status === "DONE" && payment.totalAmount === ours.amount) {
      await finishPaid(db, { paymentId: ours.id, payment, now });
      return "paid (late)";
    }
    if (payment.status === "ABORTED" || payment.status === "EXPIRED") {
      await db
        .update(schema.payments)
        .set({ status: "failed", failCode: payment.status, raw: trimPayment(payment) })
        .where(eq(schema.payments.id, ours.id));
      return "failed";
    }
    return `ready (${payment.status})`;
  }

  if (payment.status === "CANCELED" || payment.status === "PARTIAL_CANCELED") {
    const canceledTotal = (payment.cancels ?? []).reduce((n, c) => n + c.cancelAmount, 0);
    if (canceledTotal <= ours.canceledAmount) return "already synced";
    const diff = canceledTotal - ours.canceledAmount;
    const [item] = await db
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, ours.orderId));
    const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, ours.orderId));
    // 처리 중인 요청이 있으면 그것을 끝내고, 없으면 바깥에서 취소한 기록을 새로 만든다
    const [open] = await db
      .select()
      .from(schema.refunds)
      .where(
        and(
          eq(schema.refunds.orderItemId, item!.id),
          inArray(schema.refunds.status, ["requested", "approved"]),
        ),
      );
    const refundId =
      open?.id ??
      (
        await db
          .insert(schema.refunds)
          .values({
            orderItemId: item!.id,
            userId: order!.userId,
            status: "approved",
            calculation: { source: "toss-webhook", note: "토스에서 직접 취소됨" },
            requestedAmount: diff,
            approvedAmount: diff,
            reason: "토스에서 직접 취소",
            decidedAt: now,
          })
          .returning({ id: schema.refunds.id })
      )[0]!.id;
    if (open)
      await db
        .update(schema.refunds)
        .set({ approvedAmount: diff, decidedAt: open.decidedAt ?? now })
        .where(eq(schema.refunds.id, open.id));
    await applyCancel(db, { payment, paymentId: ours.id, refundId, now });
    return `canceled ${diff}`;
  }
  return `no change (${payment.status})`;
}
