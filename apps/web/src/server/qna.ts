// 강의 Q&A (L-06) + 운영자 Q&A 관리 (AD-17).
// 권한은 packages/core (canAsk · canAnswer · questionView …) 규칙으로, 여기서는 DB 를 읽고 쓴다.
//   보기 · 답하기: 그 강의를 볼 수 있는 사람 (수강권 있는 수강생 · 그 과정 강사 · 운영자)
//   질문하기: 수강권 있는 수강생만
//   비밀글: 질문자 · 그 과정 강사 · 운영자만 (다른 수강생에게는 "비밀글입니다")
import type { QnaActor, QnaDenied, QnaRole, QuestionView } from "@aionit/core";
import {
  canAnswer,
  canAsk,
  canPin,
  canReport,
  canResolve,
  findSecrets,
  isDeliverableEmail,
  isStaffRole,
  POSTING_LIMITS,
  questionView,
  sortAnswers,
  STALE_UNANSWERED_MS,
} from "@aionit/core";
import type { Db, ReportTarget } from "@aionit/db";
import { and, asc, count, desc, eq, gt, inArray, isNull, lte, or, schema, sql } from "@aionit/db";
import type { MailJob } from "@aionit/mail";
import type { CourseViewAccess } from "./entitlements";
import { canLearn, viewAccess } from "./entitlements";
import { hasUnread, notificationPrefs, notify } from "./notifications";
import { writeAudit } from "./records";
import { SupportError } from "./support-error";
import type { Viewer } from "./viewer";

export interface QnaDeps {
  db: Db;
  enqueueMail: (job: MailJob) => Promise<void>;
  /** 메일 속 주소의 기준 (BETTER_AUTH_URL) */
  baseUrl: string;
}

const DENIED: Record<QnaDenied, [number, string]> = {
  NOT_LEARNER: [403, "수강 중인 강의에서만 Q&A 를 쓸 수 있습니다."],
  STAFF_CANNOT_ASK: [403, "강사 · 운영자는 질문 대신 답변을 남길 수 있습니다."],
  CANNOT_SEE: [403, "비밀글은 질문자 · 강사 · 운영자만 볼 수 있습니다."],
  NOT_AUTHOR: [403, "질문한 사람만 할 수 있습니다."],
  NOT_STAFF: [403, "강사 · 운영자만 할 수 있습니다."],
  OWN_POST: [400, "내 글은 신고할 수 없습니다."],
  GONE: [400, "지웠거나 숨긴 글입니다."],
};

function deny(code: QnaDenied | null): void {
  if (!code) return;
  const [status, message] = DENIED[code];
  throw new SupportError(status, code, message);
}

/** 글자 그대로 찾기 (사용자가 넣은 % _ 는 와일드카드가 아니다) */
const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

const WITHDRAWN = "탈퇴한 회원";

type CourseForQna = {
  id: string;
  slug: string;
  title: string;
  inSubscription: boolean;
  ownerInstructorId: string;
  publishedVersionId: string | null;
};

async function loadCourse(db: Db, courseId: string): Promise<CourseForQna> {
  const [course] = await db
    .select({
      id: schema.courses.id,
      slug: schema.courses.slug,
      title: schema.courses.title,
      inSubscription: schema.courses.inSubscription,
      ownerInstructorId: schema.courses.ownerInstructorId,
      publishedVersionId: schema.courses.publishedVersionId,
    })
    .from(schema.courses)
    .where(eq(schema.courses.id, courseId));
  if (!course) throw new SupportError(404, "NOT_FOUND", "강의를 찾을 수 없습니다.");
  return course;
}

/** 이 사람이 이 과정 Q&A 에서 어떤 자리인가 */
export async function qnaActor(
  db: Db,
  viewer: Viewer,
  course: CourseForQna,
  now = new Date(),
): Promise<QnaActor> {
  const access: CourseViewAccess = await viewAccess(db, viewer, course, now);
  const role: QnaRole =
    access.kind === "staff" ? (viewer.roles.includes("operator") ? "operator" : "instructor") : "learner";
  return { userId: viewer.userId, role, canLearn: canLearn(access) };
}

async function requireReader(db: Db, viewer: Viewer, courseId: string) {
  const course = await loadCourse(db, courseId);
  const actor = await qnaActor(db, viewer, course);
  if (!actor.canLearn) deny("NOT_LEARNER");
  return { course, actor };
}

/** 그 과정 강사의 회원 id (아직 가입하지 않은 강사면 없음) */
async function ownerUserId(db: Db, course: CourseForQna): Promise<string | null> {
  const [row] = await db
    .select({ userId: schema.instructors.userId })
    .from(schema.instructors)
    .where(eq(schema.instructors.id, course.ownerInstructorId));
  return row?.userId ?? null;
}

async function chapterKeys(db: Db, course: CourseForQna): Promise<Map<string, string>> {
  if (!course.publishedVersionId) return new Map();
  const rows = await db
    .select({ key: schema.chapters.chapterKey, label: schema.chapters.label, title: schema.chapters.title })
    .from(schema.chapters)
    .where(eq(schema.chapters.courseVersionId, course.publishedVersionId));
  return new Map(rows.map((r) => [r.key, `${r.label.replace(/^CHAPTER\s*/i, "CH") || r.key} ${r.title}`]));
}

function checkSecrets(text: string, confirmed: boolean | undefined) {
  if (confirmed) return;
  const found = findSecrets(text);
  if (found.length > 0)
    throw new SupportError(
      409,
      "SECRET_SUSPECTED",
      "API 키처럼 보이는 글자가 있습니다. 키를 지우고 올려 주세요.",
      found,
    );
}

async function assertPostingLimit(db: Db, table: "questions" | "answers", userId: string, now: Date) {
  const t = table === "questions" ? schema.questions : schema.answers;
  const limit = table === "questions" ? POSTING_LIMITS.questionsPerHour : POSTING_LIMITS.answersPerHour;
  const [row] = await db
    .select({ n: count() })
    .from(t)
    .where(and(eq(t.authorId, userId), gt(t.createdAt, new Date(now.getTime() - 3_600_000))));
  if ((row?.n ?? 0) >= limit)
    throw new SupportError(429, "TOO_MANY_POSTS", "글을 너무 많이 올렸습니다. 잠시 뒤 다시 올려 주세요.");
}

// ---- 목록 · 상세 ----

export type QnaFilter = "all" | "open" | "mine";

export interface QuestionListItem {
  id: string;
  chapterKey: string;
  /** 지금 공개본에 없는 챕터면 null ("이전 버전의 질문") */
  chapterName: string | null;
  view: QuestionView;
  /** locked 이면 비어 있다 */
  title: string | null;
  status: "open" | "resolved";
  isSecret: boolean;
  pinned: boolean;
  hidden: boolean;
  answerCount: number;
  staffAnswered: boolean;
  mine: boolean;
  author: string;
  createdAt: Date;
}

/** L-06 목록: 고정 ➔ 최신순. 검색은 볼 수 있는 글(비밀글은 내 것 · 강사 · 운영자)에서만 찾는다 */
export async function listQuestions(
  db: Db,
  viewer: Viewer,
  input: { courseId: string; chapterKey?: string | null; filter?: QnaFilter; q?: string | null },
): Promise<{ items: QuestionListItem[]; role: QnaRole; canAsk: boolean }> {
  const { course, actor } = await requireReader(db, viewer, input.courseId);
  const staff = isStaffRole(actor.role);
  const q = schema.questions;
  const conditions = [eq(q.courseId, course.id), isNull(q.deletedAt)];
  if (input.chapterKey) conditions.push(eq(q.chapterKey, input.chapterKey));
  if (input.filter === "open") conditions.push(eq(q.status, "open"));
  if (input.filter === "mine") conditions.push(eq(q.authorId, viewer.userId));
  // 숨긴 글은 작성자 · 강사 · 운영자 목록에만
  if (!staff) conditions.push(or(isNull(q.hiddenAt), eq(q.authorId, viewer.userId))!);
  const search = input.q?.trim();
  if (search) {
    const pattern = likePattern(search.slice(0, 100));
    conditions.push(sql`(${q.title} ilike ${pattern} or ${q.bodyMd} ilike ${pattern})`);
    if (!staff) conditions.push(or(eq(q.isSecret, false), eq(q.authorId, viewer.userId))!);
  }
  const rows = await db
    .select({
      question: q,
      nickname: schema.users.nickname,
      staffAnswered: sql<boolean>`exists (select 1 from answers a where a.question_id = ${q.id}
        and a.author_role <> 'learner' and a.deleted_at is null and a.hidden_at is null)`,
    })
    .from(q)
    .innerJoin(schema.users, eq(schema.users.id, q.authorId))
    .where(and(...conditions))
    .orderBy(sql`${q.pinnedAt} is null`, desc(q.pinnedAt), desc(q.createdAt))
    .limit(100);
  const names = await chapterKeys(db, course);
  return {
    role: actor.role,
    canAsk: canAsk(actor) === null,
    items: rows.map(({ question, nickname, staffAnswered }) => {
      const view = questionView(question, actor);
      return {
        id: question.id,
        chapterKey: question.chapterKey,
        chapterName: names.get(question.chapterKey) ?? null,
        view,
        title: view === "full" ? question.title : null,
        status: question.status,
        isSecret: question.isSecret,
        pinned: !!question.pinnedAt,
        hidden: !!question.hiddenAt,
        answerCount: question.answerCount,
        staffAnswered,
        mine: question.authorId === viewer.userId,
        author: view === "full" ? (nickname ?? WITHDRAWN) : "",
        createdAt: question.createdAt,
      };
    }),
  };
}

/** 학습 머리글의 Q&A 버튼: 이 챕터의 미해결 질문 수 */
export async function openQuestionCount(db: Db, courseId: string, chapterKey: string): Promise<number> {
  const q = schema.questions;
  const [row] = await db
    .select({ n: count() })
    .from(q)
    .where(
      and(
        eq(q.courseId, courseId),
        eq(q.chapterKey, chapterKey),
        eq(q.status, "open"),
        isNull(q.hiddenAt),
        isNull(q.deletedAt),
      ),
    );
  return row?.n ?? 0;
}

async function loadQuestion(db: Db, id: string) {
  const [question] = await db.select().from(schema.questions).where(eq(schema.questions.id, id));
  if (!question) throw new SupportError(404, "NOT_FOUND", "질문을 찾을 수 없습니다.");
  return question;
}

export async function questionDetail(db: Db, viewer: Viewer, id: string) {
  const question = await loadQuestion(db, id);
  const { course, actor } = await requireReader(db, viewer, question.courseId);
  const view = questionView(question, actor);
  if (view === "deleted") throw new SupportError(404, "DELETED", "작성자가 지운 질문입니다.");
  if (view === "hidden") throw new SupportError(403, "HIDDEN", "운영자가 숨긴 글입니다.");
  if (view === "locked") deny("CANNOT_SEE");
  const staff = isStaffRole(actor.role);
  const [[author], answerRows, myReports] = await Promise.all([
    db
      .select({ nickname: schema.users.nickname })
      .from(schema.users)
      .where(eq(schema.users.id, question.authorId)),
    db
      .select({ answer: schema.answers, nickname: schema.users.nickname })
      .from(schema.answers)
      .innerJoin(schema.users, eq(schema.users.id, schema.answers.authorId))
      .where(eq(schema.answers.questionId, id))
      .orderBy(asc(schema.answers.createdAt)),
    db
      .select({ targetType: schema.reports.targetType, targetId: schema.reports.targetId })
      .from(schema.reports)
      .where(eq(schema.reports.reporterId, viewer.userId)),
  ]);
  const reported = new Set(myReports.map((r) => `${r.targetType}:${r.targetId}`));
  const names = await chapterKeys(db, course);
  const answers = sortAnswers(
    answerRows
      .filter(({ answer }) => !answer.deletedAt)
      .map(({ answer, nickname }) => {
        const mine = answer.authorId === viewer.userId;
        const hiddenForMe = !!answer.hiddenAt && !mine && !staff;
        return {
          id: answer.id,
          authorRole: answer.authorRole,
          author: nickname ?? WITHDRAWN,
          body: hiddenForMe ? null : answer.bodyMd,
          hidden: !!answer.hiddenAt,
          hiddenReason: staff || mine ? answer.hiddenReason : null,
          mine,
          reported: reported.has(`answer:${answer.id}`),
          canReport: !mine && !answer.hiddenAt && actor.canLearn,
          createdAt: answer.createdAt,
        };
      }),
  );
  const mine = question.authorId === viewer.userId;
  return {
    course: { id: course.id, slug: course.slug, title: course.title },
    role: actor.role,
    question: {
      id: question.id,
      chapterKey: question.chapterKey,
      chapterName: names.get(question.chapterKey) ?? null,
      sectionId: question.sectionId,
      title: question.title,
      body: question.bodyMd,
      isSecret: question.isSecret,
      status: question.status,
      pinned: !!question.pinnedAt,
      hidden: !!question.hiddenAt,
      hiddenReason: staff || mine ? question.hiddenReason : null,
      author: author?.nickname ?? WITHDRAWN,
      mine,
      reported: reported.has(`question:${question.id}`),
      createdAt: question.createdAt,
    },
    answers,
    can: {
      answer: canAnswer(question, actor) === null,
      resolve: canResolve(question, actor) === null,
      pin: canPin(actor) === null,
      report: canReport(question, true, actor) === null && !question.hiddenAt,
      delete: mine,
    },
  };
}

export type QuestionDetail = Awaited<ReturnType<typeof questionDetail>>;

// ---- 쓰기 ----

export async function askQuestion(
  deps: QnaDeps,
  viewer: Viewer,
  input: {
    courseId: string;
    chapterKey: string;
    sectionId?: string | null;
    title: string;
    body: string;
    secret: boolean;
    confirmSecret?: boolean;
  },
  now = new Date(),
): Promise<string> {
  const { db } = deps;
  const course = await loadCourse(db, input.courseId);
  const actor = await qnaActor(db, viewer, course, now);
  deny(canAsk(actor));
  if (!(await chapterKeys(db, course)).has(input.chapterKey))
    throw new SupportError(400, "CHAPTER_NOT_FOUND", "챕터를 찾을 수 없습니다.");
  checkSecrets(`${input.title}\n${input.body}`, input.confirmSecret);
  await assertPostingLimit(db, "questions", viewer.userId, now);
  const [row] = await db
    .insert(schema.questions)
    .values({
      courseId: course.id,
      chapterKey: input.chapterKey,
      sectionId: input.sectionId ?? null,
      authorId: viewer.userId,
      title: input.title,
      bodyMd: input.body,
      isSecret: input.secret,
    })
    .returning({ id: schema.questions.id });
  // 그 과정 강사에게 사이트 알림 (강사 화면 I-06 은 M8)
  const owner = await ownerUserId(db, course);
  if (owner && owner !== viewer.userId)
    await notify(db, {
      userId: owner,
      kind: "qna_question",
      title: `새 질문: ${input.secret ? "(비밀글)" : input.title}`,
      body: course.title,
      url: questionUrl(course.slug, input.chapterKey, row!.id),
      targetId: row!.id,
    });
  return row!.id;
}

export const questionUrl = (slug: string, chapterKey: string, questionId: string) =>
  `/learn/${slug}/${chapterKey}?qna=${questionId}`;

export async function answerQuestion(
  deps: QnaDeps,
  viewer: Viewer,
  questionId: string,
  input: { body: string; confirmSecret?: boolean },
  now = new Date(),
): Promise<string> {
  const { db } = deps;
  const question = await loadQuestion(db, questionId);
  const course = await loadCourse(db, question.courseId);
  const actor = await qnaActor(db, viewer, course, now);
  deny(canAnswer(question, actor));
  checkSecrets(input.body, input.confirmSecret);
  await assertPostingLimit(db, "answers", viewer.userId, now);
  const answerId = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.answers)
      .values({ questionId, authorId: viewer.userId, authorRole: actor.role, bodyMd: input.body })
      .returning({ id: schema.answers.id });
    await tx
      .update(schema.questions)
      .set({ answerCount: sql`${schema.questions.answerCount} + 1`, lastAnsweredAt: now })
      .where(eq(schema.questions.id, questionId));
    return row!.id;
  });
  if (question.authorId !== viewer.userId) await notifyAnswer(deps, question, course, actor.role);
  return answerId;
}

/** 질문자에게 새 답변 알림. 메일은 설정을 따르고, 같은 질문의 알림을 아직 읽지 않았으면 또 보내지 않는다 */
async function notifyAnswer(
  deps: QnaDeps,
  question: typeof schema.questions.$inferSelect,
  course: CourseForQna,
  role: QnaRole,
) {
  const { db } = deps;
  const [author] = await db
    .select({ email: schema.users.email, status: schema.users.status })
    .from(schema.users)
    .where(eq(schema.users.id, question.authorId));
  if (!author || author.status !== "active") return;
  const alreadyUnread = await hasUnread(db, question.authorId, "qna_answer", question.id);
  const url = questionUrl(course.slug, question.chapterKey, question.id);
  await notify(db, {
    userId: question.authorId,
    kind: "qna_answer",
    title: `${isStaffRole(role) ? "강사 답변" : "새 답변"}: ${question.title}`,
    body: course.title,
    url,
    targetId: question.id,
  });
  const prefs = await notificationPrefs(db, question.authorId);
  if (alreadyUnread || !prefs.qnaAnswerEmail || !isDeliverableEmail(author.email)) return;
  await deps
    .enqueueMail({
      template: "qna-answer",
      to: author.email,
      userId: question.authorId,
      courseTitle: course.title,
      questionTitle: question.title,
      fromStaff: isStaffRole(role),
      url: `${deps.baseUrl}${url}`,
    })
    .catch((error: unknown) => console.error(`[qna] 메일 넣기 실패 ${question.id}`, error));
}

export type QuestionAction = "resolve" | "reopen" | "pin" | "unpin" | "delete";

export async function changeQuestion(
  db: Db,
  viewer: Viewer,
  id: string,
  action: QuestionAction,
  now = new Date(),
): Promise<void> {
  const question = await loadQuestion(db, id);
  const course = await loadCourse(db, question.courseId);
  const actor = await qnaActor(db, viewer, course, now);
  const where = eq(schema.questions.id, id);
  switch (action) {
    case "resolve":
    case "reopen":
      deny(canResolve(question, actor));
      await db
        .update(schema.questions)
        .set(
          action === "resolve"
            ? { status: "resolved", resolvedAt: now }
            : { status: "open", resolvedAt: null },
        )
        .where(where);
      return;
    case "pin":
    case "unpin":
      deny(canPin(actor));
      await db
        .update(schema.questions)
        .set({ pinnedAt: action === "pin" ? now : null })
        .where(where);
      return;
    case "delete":
      if (question.authorId !== viewer.userId) deny("NOT_AUTHOR");
      // 내용을 비운다 (잘못 올린 키 · 개인정보가 남지 않게). 달린 답변은 남는다
      await db
        .update(schema.questions)
        .set({ deletedAt: now, title: "", bodyMd: "", pinnedAt: null })
        .where(where);
      return;
  }
}

export async function deleteAnswer(
  db: Db,
  viewer: Viewer,
  answerId: string,
  now = new Date(),
): Promise<void> {
  const [answer] = await db.select().from(schema.answers).where(eq(schema.answers.id, answerId));
  if (!answer || answer.deletedAt) throw new SupportError(404, "NOT_FOUND", "답변을 찾을 수 없습니다.");
  if (answer.authorId !== viewer.userId) deny("NOT_AUTHOR");
  await db.transaction(async (tx) => {
    await tx
      .update(schema.answers)
      .set({ deletedAt: now, bodyMd: "" })
      .where(eq(schema.answers.id, answerId));
    await tx
      .update(schema.questions)
      .set({ answerCount: sql`greatest(${schema.questions.answerCount} - 1, 0)` })
      .where(eq(schema.questions.id, answer.questionId));
  });
}

/** 신고. 같은 글을 두 번 신고해도 한 번만 남는다 */
export async function reportPost(
  db: Db,
  viewer: Viewer,
  input: { targetType: ReportTarget; targetId: string; reason: string; detail?: string | null },
): Promise<{ created: boolean }> {
  let question: typeof schema.questions.$inferSelect;
  let target: { authorId: string; deletedAt: Date | null; hiddenAt: Date | null };
  if (input.targetType === "question") {
    question = await loadQuestion(db, input.targetId);
    target = question;
  } else {
    const [answer] = await db.select().from(schema.answers).where(eq(schema.answers.id, input.targetId));
    if (!answer) throw new SupportError(404, "NOT_FOUND", "답변을 찾을 수 없습니다.");
    question = await loadQuestion(db, answer.questionId);
    target = answer;
  }
  const course = await loadCourse(db, question.courseId);
  const actor = await qnaActor(db, viewer, course);
  const visible = questionView(question, actor) === "full" && !target.hiddenAt;
  deny(canReport(target, visible, actor));
  const rows = await db
    .insert(schema.reports)
    .values({
      targetType: input.targetType,
      targetId: input.targetId,
      courseId: course.id,
      reporterId: viewer.userId,
      reason: input.reason,
      detail: input.detail ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: schema.reports.id });
  return { created: rows.length > 0 };
}

/** 내 질문 (마이페이지) */
export async function myQuestions(db: Db, userId: string) {
  const q = schema.questions;
  return db
    .select({
      id: q.id,
      title: q.title,
      chapterKey: q.chapterKey,
      status: q.status,
      isSecret: q.isSecret,
      answerCount: q.answerCount,
      hidden: sql<boolean>`${q.hiddenAt} is not null`,
      createdAt: q.createdAt,
      courseSlug: schema.courses.slug,
      courseTitle: schema.courses.title,
    })
    .from(q)
    .innerJoin(schema.courses, eq(schema.courses.id, q.courseId))
    .where(and(eq(q.authorId, userId), isNull(q.deletedAt)))
    .orderBy(desc(q.createdAt))
    .limit(200);
}

// ---- 운영자 Q&A 관리 (AD-17) ----

/** 신고가 들어온 글 (글마다 한 줄, 신고 수 · 사유) */
export async function reportedPosts(db: Db) {
  const rows = await db
    .select({
      targetType: schema.reports.targetType,
      targetId: schema.reports.targetId,
      courseId: schema.reports.courseId,
      reason: schema.reports.reason,
      detail: schema.reports.detail,
      createdAt: schema.reports.createdAt,
    })
    .from(schema.reports)
    .where(eq(schema.reports.status, "open"))
    .orderBy(asc(schema.reports.createdAt));
  const groups = new Map<
    string,
    { targetType: ReportTarget; targetId: string; reasons: string[]; details: string[]; firstAt: Date }
  >();
  for (const r of rows) {
    const key = `${r.targetType}:${r.targetId}`;
    const g = groups.get(key) ?? {
      targetType: r.targetType,
      targetId: r.targetId,
      reasons: [],
      details: [],
      firstAt: r.createdAt,
    };
    g.reasons.push(r.reason);
    if (r.detail) g.details.push(r.detail);
    groups.set(key, g);
  }
  const list = [...groups.values()];
  const posts = await moderationTargets(
    db,
    list.map((g) => ({ targetType: g.targetType, targetId: g.targetId })),
  );
  return list.map((g) => ({ ...g, post: posts.get(`${g.targetType}:${g.targetId}`) ?? null }));
}

/** 운영자 화면에 보여 줄 글 내용 (질문 · 답변 공통) */
async function moderationTargets(db: Db, targets: { targetType: ReportTarget; targetId: string }[]) {
  const result = new Map<
    string,
    {
      questionId: string;
      title: string;
      body: string;
      author: string;
      authorRole: QnaRole | "asker";
      hidden: boolean;
      hiddenReason: string | null;
      deleted: boolean;
      courseTitle: string;
      url: string;
    }
  >();
  const questionIds = targets.filter((t) => t.targetType === "question").map((t) => t.targetId);
  const answerIds = targets.filter((t) => t.targetType === "answer").map((t) => t.targetId);
  const answerRows = answerIds.length
    ? await db
        .select({ answer: schema.answers, nickname: schema.users.nickname })
        .from(schema.answers)
        .innerJoin(schema.users, eq(schema.users.id, schema.answers.authorId))
        .where(inArray(schema.answers.id, answerIds))
    : [];
  const allQuestionIds = [...new Set([...questionIds, ...answerRows.map((a) => a.answer.questionId)])];
  const questionRows = allQuestionIds.length
    ? await db
        .select({
          question: schema.questions,
          nickname: schema.users.nickname,
          courseTitle: schema.courses.title,
          slug: schema.courses.slug,
        })
        .from(schema.questions)
        .innerJoin(schema.users, eq(schema.users.id, schema.questions.authorId))
        .innerJoin(schema.courses, eq(schema.courses.id, schema.questions.courseId))
        .where(inArray(schema.questions.id, allQuestionIds))
    : [];
  const questions = new Map(questionRows.map((r) => [r.question.id, r]));
  for (const r of questionRows) {
    if (!questionIds.includes(r.question.id)) continue;
    result.set(`question:${r.question.id}`, {
      questionId: r.question.id,
      title: r.question.title,
      body: r.question.bodyMd,
      author: r.nickname ?? WITHDRAWN,
      authorRole: "asker",
      hidden: !!r.question.hiddenAt,
      hiddenReason: r.question.hiddenReason,
      deleted: !!r.question.deletedAt,
      courseTitle: r.courseTitle,
      url: questionUrl(r.slug, r.question.chapterKey, r.question.id),
    });
  }
  for (const { answer, nickname } of answerRows) {
    const q = questions.get(answer.questionId);
    if (!q) continue;
    result.set(`answer:${answer.id}`, {
      questionId: q.question.id,
      title: q.question.title,
      body: answer.bodyMd,
      author: nickname ?? WITHDRAWN,
      authorRole: answer.authorRole,
      hidden: !!answer.hiddenAt,
      hiddenReason: answer.hiddenReason,
      deleted: !!answer.deletedAt,
      courseTitle: q.courseTitle,
      url: questionUrl(q.slug, q.question.chapterKey, q.question.id),
    });
  }
  return result;
}

/** 답변 없이 3일 지난 열린 질문 (오래 기다린 순) */
export async function staleQuestions(db: Db, now = new Date()) {
  const q = schema.questions;
  return db
    .select({
      id: q.id,
      title: q.title,
      isSecret: q.isSecret,
      chapterKey: q.chapterKey,
      createdAt: q.createdAt,
      courseTitle: schema.courses.title,
      slug: schema.courses.slug,
    })
    .from(q)
    .innerJoin(schema.courses, eq(schema.courses.id, q.courseId))
    .where(
      and(
        eq(q.status, "open"),
        eq(q.answerCount, 0),
        isNull(q.hiddenAt),
        isNull(q.deletedAt),
        lte(q.createdAt, new Date(now.getTime() - STALE_UNANSWERED_MS)),
      ),
    )
    .orderBy(asc(q.createdAt))
    .limit(100);
}

/** 숨긴 글 목록 (다시 보이게 할 수 있다) */
export async function hiddenPosts(db: Db) {
  const [qs, as] = await Promise.all([
    db
      .select({ id: schema.questions.id })
      .from(schema.questions)
      .where(sql`${schema.questions.hiddenAt} is not null`)
      .orderBy(desc(schema.questions.hiddenAt))
      .limit(50),
    db
      .select({ id: schema.answers.id })
      .from(schema.answers)
      .where(sql`${schema.answers.hiddenAt} is not null`)
      .orderBy(desc(schema.answers.hiddenAt))
      .limit(50),
  ]);
  const targets = [
    ...qs.map((r) => ({ targetType: "question" as const, targetId: r.id })),
    ...as.map((r) => ({ targetType: "answer" as const, targetId: r.id })),
  ];
  const posts = await moderationTargets(db, targets);
  return targets.flatMap((t) => {
    const post = posts.get(`${t.targetType}:${t.targetId}`);
    return post ? [{ ...t, post }] : [];
  });
}

/** 숨기기 · 다시 보이기 (사유 필수). 숨기면 그 글의 신고는 처리됨, 작성자에게 알림 */
export async function moderatePost(
  db: Db,
  input: {
    actorId: string;
    targetType: ReportTarget;
    targetId: string;
    hide: boolean;
    reason: string;
    headers?: Headers | null;
  },
  now = new Date(),
): Promise<void> {
  const table = input.targetType === "question" ? schema.questions : schema.answers;
  const [row] = await db
    .select({ authorId: table.authorId, hiddenAt: table.hiddenAt })
    .from(table)
    .where(eq(table.id, input.targetId));
  if (!row) throw new SupportError(404, "NOT_FOUND", "글을 찾을 수 없습니다.");
  const question =
    input.targetType === "question"
      ? await loadQuestion(db, input.targetId)
      : await db
          .select({ questionId: schema.answers.questionId })
          .from(schema.answers)
          .where(eq(schema.answers.id, input.targetId))
          .then(([a]) => loadQuestion(db, a!.questionId));
  const course = await loadCourse(db, question.courseId);
  await db.transaction(async (tx) => {
    await tx
      .update(table)
      .set(
        input.hide
          ? { hiddenAt: now, hiddenReason: input.reason, hiddenBy: input.actorId }
          : { hiddenAt: null, hiddenReason: null, hiddenBy: null },
      )
      .where(eq(table.id, input.targetId));
    if (input.hide)
      await tx
        .update(schema.reports)
        .set({ status: "hidden", handledBy: input.actorId, handledAt: now })
        .where(
          and(
            eq(schema.reports.targetType, input.targetType),
            eq(schema.reports.targetId, input.targetId),
            eq(schema.reports.status, "open"),
          ),
        );
    await writeAudit(tx, {
      actorId: input.actorId,
      action: input.hide ? "qna.hide" : "qna.unhide",
      targetType: input.targetType,
      targetId: input.targetId,
      before: { hidden: !!row.hiddenAt },
      after: { hidden: input.hide, reason: input.reason },
      headers: input.headers,
    });
    if (input.hide)
      await notify(tx, {
        userId: row.authorId,
        kind: "qna_hidden",
        title: `운영자가 ${input.targetType === "question" ? "질문" : "답변"}을 숨겼습니다`,
        body: `사유: ${input.reason}`,
        url: questionUrl(course.slug, question.chapterKey, question.id),
        targetId: input.targetId,
      });
  });
}

/** 문제없는 신고로 정리 */
export async function dismissReports(
  db: Db,
  input: { actorId: string; targetType: ReportTarget; targetId: string; headers?: Headers | null },
  now = new Date(),
): Promise<number> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(schema.reports)
      .set({ status: "dismissed", handledBy: input.actorId, handledAt: now })
      .where(
        and(
          eq(schema.reports.targetType, input.targetType),
          eq(schema.reports.targetId, input.targetId),
          eq(schema.reports.status, "open"),
        ),
      )
      .returning({ id: schema.reports.id });
    if (rows.length > 0)
      await writeAudit(tx, {
        actorId: input.actorId,
        action: "qna.report_dismiss",
        targetType: input.targetType,
        targetId: input.targetId,
        after: { reports: rows.length },
        headers: input.headers,
      });
    return rows.length;
  });
}
