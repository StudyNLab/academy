// 1:1 문의 (M-05 회원 · AD-13 운영자). 소비자 불만 · 분쟁 기록이라 글은 고치거나 지우지 않고 3년 보관한다 (DB 트리거).
// 운영자가 문의를 열어 보면 개인정보 조회 기록(pii_access_logs)에, 답변 · 닫기는 작업 기록(audit_logs)에 남긴다.
import type { InquiryEvent } from "@aionit/core";
import { isDeliverableEmail, nextInquiryState, POSTING_LIMITS } from "@aionit/core";
import type { Db, InquiryStatus } from "@aionit/db";
import { and, asc, count, desc, eq, gt, schema, sql } from "@aionit/db";
import type { MailJob } from "@aionit/mail";
import { notify } from "./notifications";
import { recordPiiAccess, writeAudit } from "./records";
import { SupportError } from "./support-error";
import type { Viewer } from "./viewer";

export interface InquiryDeps {
  db: Db;
  enqueueMail: (job: MailJob) => Promise<void>;
  baseUrl: string;
}

type Inquiry = typeof schema.inquiries.$inferSelect;

async function loadInquiry(db: Pick<Db, "select">, id: string): Promise<Inquiry> {
  const [row] = await db.select().from(schema.inquiries).where(eq(schema.inquiries.id, id));
  if (!row) throw new SupportError(404, "NOT_FOUND", "문의를 찾을 수 없습니다.");
  return row;
}

function transition(inquiry: Inquiry, event: InquiryEvent): InquiryStatus {
  const next = nextInquiryState(inquiry.status, event);
  if (!next) throw new SupportError(400, "CLOSED", "끝난 문의입니다. 새 문의로 남겨 주세요.");
  return next;
}

async function messages(db: Db, inquiryId: string) {
  return db
    .select({
      id: schema.inquiryMessages.id,
      authorRole: schema.inquiryMessages.authorRole,
      body: schema.inquiryMessages.body,
      createdAt: schema.inquiryMessages.createdAt,
    })
    .from(schema.inquiryMessages)
    .where(eq(schema.inquiryMessages.inquiryId, inquiryId))
    .orderBy(asc(schema.inquiryMessages.createdAt));
}

// ---- 회원 (M-05) ----

export async function createInquiry(
  db: Db,
  viewer: Viewer,
  input: { category: string; title: string; body: string },
  now = new Date(),
): Promise<string> {
  const [recent] = await db
    .select({ n: count() })
    .from(schema.inquiries)
    .where(
      and(
        eq(schema.inquiries.userId, viewer.userId),
        gt(schema.inquiries.createdAt, new Date(now.getTime() - 86_400_000)),
      ),
    );
  if ((recent?.n ?? 0) >= POSTING_LIMITS.inquiriesPerDay)
    throw new SupportError(
      429,
      "TOO_MANY_INQUIRIES",
      "오늘은 문의를 더 남길 수 없습니다. 이미 남긴 문의에 이어서 써 주세요.",
    );
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.inquiries)
      .values({ userId: viewer.userId, category: input.category, title: input.title, lastMessageAt: now })
      .returning({ id: schema.inquiries.id });
    await tx
      .insert(schema.inquiryMessages)
      .values({ inquiryId: row!.id, authorId: viewer.userId, authorRole: "member", body: input.body });
    return row!.id;
  });
}

export async function myInquiries(db: Db, userId: string) {
  return db
    .select()
    .from(schema.inquiries)
    .where(eq(schema.inquiries.userId, userId))
    .orderBy(desc(schema.inquiries.createdAt))
    .limit(200);
}

/** 내 문의 하나 (남의 문의는 없는 것처럼) */
export async function inquiryForMember(db: Db, viewer: Viewer, id: string) {
  const inquiry = await loadInquiry(db, id);
  if (inquiry.userId !== viewer.userId) throw new SupportError(404, "NOT_FOUND", "문의를 찾을 수 없습니다.");
  return { inquiry, messages: await messages(db, id) };
}

/** 회원이 이어서 쓰기 ➔ 다시 답변 기다림 */
export async function addMemberMessage(
  db: Db,
  viewer: Viewer,
  id: string,
  body: string,
  now = new Date(),
): Promise<void> {
  await db.transaction(async (tx) => {
    const inquiry = await loadInquiry(tx, id);
    if (inquiry.userId !== viewer.userId)
      throw new SupportError(404, "NOT_FOUND", "문의를 찾을 수 없습니다.");
    const status = transition(inquiry, "member_message");
    await tx
      .insert(schema.inquiryMessages)
      .values({ inquiryId: id, authorId: viewer.userId, authorRole: "member", body });
    await tx.update(schema.inquiries).set({ status, lastMessageAt: now }).where(eq(schema.inquiries.id, id));
  });
}

/** 회원이 "해결됐어요" 로 닫기 */
export async function closeInquiryByMember(
  db: Db,
  viewer: Viewer,
  id: string,
  now = new Date(),
): Promise<void> {
  const inquiry = await loadInquiry(db, id);
  if (inquiry.userId !== viewer.userId) throw new SupportError(404, "NOT_FOUND", "문의를 찾을 수 없습니다.");
  transition(inquiry, "close");
  await db
    .update(schema.inquiries)
    .set({ status: "closed", closedAt: now })
    .where(eq(schema.inquiries.id, id));
}

// ---- 운영자 (AD-13) ----

/** 답변을 기다리는 문의 먼저 (오래 기다린 순), 그다음 최근 것 */
export async function adminInquiries(db: Db, scope: "open" | "all") {
  const q = db
    .select({ inquiry: schema.inquiries, nickname: schema.users.nickname })
    .from(schema.inquiries)
    .innerJoin(schema.users, eq(schema.users.id, schema.inquiries.userId));
  return scope === "open"
    ? q.where(eq(schema.inquiries.status, "open")).orderBy(asc(schema.inquiries.lastMessageAt)).limit(200)
    : q.orderBy(sql`${schema.inquiries.status} <> 'open'`, desc(schema.inquiries.lastMessageAt)).limit(200);
}

/** 회원 상세(AD-08)의 문의 목록 */
export async function inquiriesOfUser(db: Db, userId: string) {
  return myInquiries(db, userId);
}

export async function inquiryForAdmin(
  db: Db,
  actor: { userId: string; headers?: Headers | null },
  id: string,
) {
  const inquiry = await loadInquiry(db, id);
  const [user] = await db
    .select({ nickname: schema.users.nickname, status: schema.users.status })
    .from(schema.users)
    .where(eq(schema.users.id, inquiry.userId));
  await recordPiiAccess(db, {
    actorId: actor.userId,
    subjectUserId: inquiry.userId,
    fields: ["inquiry"],
    purpose: "1:1 문의 답변",
    headers: actor.headers,
  });
  return { inquiry, member: user ?? null, messages: await messages(db, id) };
}

export async function replyInquiry(
  deps: InquiryDeps,
  input: { actorId: string; id: string; body: string; close?: boolean; headers?: Headers | null },
  now = new Date(),
): Promise<void> {
  const { db } = deps;
  const inquiry = await db.transaction(async (tx) => {
    const inquiry = await loadInquiry(tx, input.id);
    let status = transition(inquiry, "operator_reply");
    if (input.close) status = transition({ ...inquiry, status }, "close");
    await tx
      .insert(schema.inquiryMessages)
      .values({ inquiryId: input.id, authorId: input.actorId, authorRole: "operator", body: input.body });
    await tx
      .update(schema.inquiries)
      .set({ status, lastMessageAt: now, ...(status === "closed" ? { closedAt: now } : {}) })
      .where(eq(schema.inquiries.id, input.id));
    await writeAudit(tx, {
      actorId: input.actorId,
      action: "inquiry.reply",
      targetType: "inquiry",
      targetId: input.id,
      after: { status },
      headers: input.headers,
    });
    const url = `/my/inquiries/${input.id}`;
    await notify(tx, {
      userId: inquiry.userId,
      kind: "inquiry_answer",
      title: `1:1 문의 답변: ${inquiry.title}`,
      url,
      targetId: input.id,
    });
    return inquiry;
  });
  const [user] = await db
    .select({ email: schema.users.email, status: schema.users.status })
    .from(schema.users)
    .where(eq(schema.users.id, inquiry.userId));
  if (!user || user.status !== "active" || !isDeliverableEmail(user.email)) return;
  await deps
    .enqueueMail({
      template: "inquiry-answer",
      to: user.email,
      userId: inquiry.userId,
      title: inquiry.title,
      url: `${deps.baseUrl}/my/inquiries/${input.id}`,
    })
    .catch((error: unknown) => console.error(`[inquiry] 메일 넣기 실패 ${input.id}`, error));
}

export async function closeInquiryByOperator(
  db: Db,
  input: { actorId: string; id: string; headers?: Headers | null },
  now = new Date(),
): Promise<void> {
  await db.transaction(async (tx) => {
    const inquiry = await loadInquiry(tx, input.id);
    transition(inquiry, "close");
    await tx
      .update(schema.inquiries)
      .set({ status: "closed", closedAt: now })
      .where(eq(schema.inquiries.id, input.id));
    await writeAudit(tx, {
      actorId: input.actorId,
      action: "inquiry.close",
      targetType: "inquiry",
      targetId: input.id,
      before: { status: inquiry.status },
      headers: input.headers,
    });
  });
}
