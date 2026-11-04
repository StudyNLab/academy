// 공지 (P-07) · 자주 묻는 질문 (P-08) + 운영자 관리 (AD-12). 운영자 작업은 audit_logs 에 남긴다.
import type { Db } from "@aionit/db";
import { and, asc, desc, eq, isNotNull, lte, schema, sql } from "@aionit/db";
import { writeAudit } from "./records";
import { SupportError } from "./support-error";

// ---- 공개 화면 ----

/** 게시한 공지: 고정 ➔ 최신순 */
export async function publishedNotices(db: Db, now = new Date()) {
  return db
    .select({
      id: schema.notices.id,
      title: schema.notices.title,
      pinned: schema.notices.pinned,
      publishedAt: schema.notices.publishedAt,
    })
    .from(schema.notices)
    .where(and(isNotNull(schema.notices.publishedAt), lte(schema.notices.publishedAt, now)))
    .orderBy(desc(schema.notices.pinned), desc(schema.notices.publishedAt))
    .limit(200);
}

/** 공지 하나. 게시 전 공지는 운영자만 (미리보기) */
export async function noticeById(
  db: Db,
  id: string,
  options: { includeDraft?: boolean } = {},
  now = new Date(),
) {
  const [row] = await db.select().from(schema.notices).where(eq(schema.notices.id, id));
  if (!row) return null;
  const published = !!row.publishedAt && row.publishedAt <= now;
  return published || options.includeDraft ? { ...row, published } : null;
}

export async function publishedFaqs(db: Db) {
  return db
    .select()
    .from(schema.faqs)
    .where(eq(schema.faqs.published, true))
    .orderBy(asc(schema.faqs.category), asc(schema.faqs.sortOrder), asc(schema.faqs.createdAt));
}

// ---- 운영자 (AD-12) ----

export async function allNotices(db: Db) {
  return db
    .select()
    .from(schema.notices)
    .orderBy(sql`${schema.notices.publishedAt} is not null`, desc(schema.notices.createdAt))
    .limit(500);
}

export async function allFaqs(db: Db) {
  return db
    .select()
    .from(schema.faqs)
    .orderBy(asc(schema.faqs.category), asc(schema.faqs.sortOrder), asc(schema.faqs.createdAt));
}

export interface NoticeInput {
  title: string;
  bodyMd: string;
  pinned: boolean;
  /** 게시하기 · 임시 저장(게시 내리기) */
  publish: boolean;
}

export async function saveNotice(
  db: Db,
  input: NoticeInput & { id?: string | null; actorId: string; headers?: Headers | null },
  now = new Date(),
): Promise<string> {
  return db.transaction(async (tx) => {
    let before: typeof schema.notices.$inferSelect | undefined;
    if (input.id) {
      [before] = await tx.select().from(schema.notices).where(eq(schema.notices.id, input.id));
      if (!before) throw new SupportError(404, "NOT_FOUND", "공지를 찾을 수 없습니다.");
    }
    // 이미 게시한 공지를 고쳐도 게시일은 처음 그대로
    const publishedAt = input.publish ? (before?.publishedAt ?? now) : null;
    const values = { title: input.title, bodyMd: input.bodyMd, pinned: input.pinned, publishedAt };
    const [row] = before
      ? await tx
          .update(schema.notices)
          .set(values)
          .where(eq(schema.notices.id, before.id))
          .returning({ id: schema.notices.id })
      : await tx
          .insert(schema.notices)
          .values({ ...values, createdBy: input.actorId })
          .returning({ id: schema.notices.id });
    await writeAudit(tx, {
      actorId: input.actorId,
      action: before ? "notice.update" : "notice.create",
      targetType: "notice",
      targetId: row!.id,
      before: before
        ? { title: before.title, published: !!before.publishedAt, pinned: before.pinned }
        : undefined,
      after: { title: input.title, published: input.publish, pinned: input.pinned },
      headers: input.headers,
    });
    return row!.id;
  });
}

export async function deleteNotice(db: Db, input: { id: string; actorId: string; headers?: Headers | null }) {
  await db.transaction(async (tx) => {
    const [row] = await tx.delete(schema.notices).where(eq(schema.notices.id, input.id)).returning();
    if (!row) throw new SupportError(404, "NOT_FOUND", "공지를 찾을 수 없습니다.");
    await writeAudit(tx, {
      actorId: input.actorId,
      action: "notice.delete",
      targetType: "notice",
      targetId: input.id,
      before: { title: row.title },
      headers: input.headers,
    });
  });
}

export interface FaqInput {
  category: string;
  question: string;
  answerMd: string;
  sortOrder: number;
  published: boolean;
}

export async function saveFaq(
  db: Db,
  input: FaqInput & { id?: string | null; actorId: string; headers?: Headers | null },
): Promise<string> {
  return db.transaction(async (tx) => {
    const values = {
      category: input.category,
      question: input.question,
      answerMd: input.answerMd,
      sortOrder: input.sortOrder,
      published: input.published,
    };
    const [row] = input.id
      ? await tx
          .update(schema.faqs)
          .set(values)
          .where(eq(schema.faqs.id, input.id))
          .returning({ id: schema.faqs.id })
      : await tx.insert(schema.faqs).values(values).returning({ id: schema.faqs.id });
    if (!row) throw new SupportError(404, "NOT_FOUND", "질문을 찾을 수 없습니다.");
    await writeAudit(tx, {
      actorId: input.actorId,
      action: input.id ? "faq.update" : "faq.create",
      targetType: "faq",
      targetId: row.id,
      after: { category: input.category, question: input.question, published: input.published },
      headers: input.headers,
    });
    return row.id;
  });
}

export async function deleteFaq(db: Db, input: { id: string; actorId: string; headers?: Headers | null }) {
  await db.transaction(async (tx) => {
    const [row] = await tx.delete(schema.faqs).where(eq(schema.faqs.id, input.id)).returning();
    if (!row) throw new SupportError(404, "NOT_FOUND", "질문을 찾을 수 없습니다.");
    await writeAudit(tx, {
      actorId: input.actorId,
      action: "faq.delete",
      targetType: "faq",
      targetId: input.id,
      before: { question: row.question },
      headers: input.headers,
    });
  });
}
