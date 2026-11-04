// 강의 Q&A · 1:1 문의 · 공지 · 자주 묻는 질문 · 알림 (개발계획 M7)
// 완료 기준: 권한 — 수강생만 질문을 쓰고, 비밀글은 질문자 · 그 과정 강사 · 운영자만 본다
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, schema, sql } from "@aionit/db";
import type { MailJob } from "@aionit/mail";
import { createMemoryStore } from "@aionit/storage";
import { processCourseVersion } from "../../worker/src/content";
import { sendExpiryReminders } from "../../worker/src/reminders";
import { purgeExpiredRecords } from "../../worker/src/retention";
import { buildZip, normalEntries } from "../../../packages/content/test/fixtures";
import { createCourse, createInstructor, publishVersion, uploadPackage } from "@/server/courses";
import { grantEntitlement } from "@/server/entitlements";
import {
  addMemberMessage,
  adminInquiries,
  closeInquiryByMember,
  createInquiry,
  inquiryForAdmin,
  inquiryForMember,
  replyInquiry,
} from "@/server/inquiries";
import {
  deleteNotice,
  noticeById,
  publishedFaqs,
  publishedNotices,
  saveFaq,
  saveNotice,
} from "@/server/notices";
import {
  markAllRead,
  myNotifications,
  notificationPrefs,
  openNotification,
  setNotificationPrefs,
  unreadCount,
} from "@/server/notifications";
import type { QnaDeps } from "@/server/qna";
import {
  answerQuestion,
  askQuestion,
  changeQuestion,
  deleteAnswer,
  dismissReports,
  listQuestions,
  moderatePost,
  myQuestions,
  openQuestionCount,
  questionDetail,
  reportedPosts,
  reportPost,
  staleQuestions,
} from "@/server/qna";
import type { Viewer } from "@/server/viewer";
import { withdrawUser } from "@/server/withdraw";
import { resetDb, setupTestAuth } from "./helpers";

const t = setupTestAuth();
const store = createMemoryStore();
afterAll(() => t.close());

const viewerOf = (userId: string, roles: Viewer["roles"] = []): Viewer => ({
  userId,
  email: "x@example.com",
  nickname: "x",
  emailVerified: true,
  twoFactorEnabled: true,
  sessionId: "s",
  sessionCreatedAt: new Date(),
  mfaVerifiedAt: new Date(),
  roles,
});

const mails: MailJob[] = [];
const deps = (): QnaDeps => ({
  db: t.db,
  enqueueMail: async (job) => void mails.push(job),
  baseUrl: "http://localhost:3000",
});

let operator: Viewer;
let instructor: Viewer;
let asker: Viewer;
let classmate: Viewer;
let outsider: Viewer;
let courseId: string;

const KEY = "sk-proj-AbCdEf0123456789AbCdEf0123456789xyz";

beforeEach(async () => {
  await resetDb(t.db);
  mails.length = 0;
  store.objects.clear();
  const users = await t.db
    .insert(schema.users)
    .values([
      { email: "op@example.com", nickname: "운영하는사람", emailVerified: true },
      { email: "teacher@example.com", nickname: "가르치는사람", emailVerified: true },
      { email: "asker@example.com", nickname: "묻는사람", emailVerified: true },
      { email: "mate@example.com", nickname: "같이듣는사람", emailVerified: true },
      { email: "out@example.com", nickname: "안듣는사람", emailVerified: true },
    ])
    .returning();
  operator = viewerOf(users[0]!.id, ["operator"]);
  instructor = viewerOf(users[1]!.id, ["instructor"]);
  asker = viewerOf(users[2]!.id);
  classmate = viewerOf(users[3]!.id);
  outsider = viewerOf(users[4]!.id);
  const owner = await createInstructor(t.db, {
    displayName: "홍길동",
    userId: instructor.userId,
    actorId: operator.userId,
  });
  const course = await createCourse(t.db, {
    slug: "ai-agent-basics",
    title: "AI Agent 개발 · 초급",
    field: "ai",
    level: "초급",
    ownerInstructorId: owner.id,
    summary: "",
    descriptionMd: "",
    audienceMd: "",
    requirementsMd: "",
    inSubscription: true,
    actorId: operator.userId,
  });
  courseId = course.id;
  const version = await uploadPackage(
    { db: t.db, store, enqueueContent: async () => undefined },
    { courseId, zip: buildZip(await normalEntries()), fileName: "pkg.zip", actorId: operator.userId },
  );
  await processCourseVersion({ db: t.db, store }, version.id);
  await publishVersion(t.db, version.id, { actorId: operator.userId });
  for (const v of [asker, classmate])
    await grantEntitlement(t.db, {
      actorId: operator.userId,
      userId: v.userId,
      courseId,
      days: 90,
      reason: "베타 수강생",
    });
});

const ask = (viewer: Viewer, overrides: Partial<Parameters<typeof askQuestion>[2]> = {}) =>
  askQuestion(deps(), viewer, {
    courseId,
    chapterKey: "ch01",
    sectionId: "sec-1",
    title: "응답이 비어 있어요",
    body: "```python\nprint(resp)\n```\n결과가 빈 칸으로 나옵니다.",
    secret: false,
    ...overrides,
  });

async function code(promise: Promise<unknown>) {
  try {
    await promise;
    return "ok";
  } catch (error) {
    return (error as { code?: string }).code ?? String(error);
  }
}

describe("강의 Q&A 권한 (L-06 완료 기준)", () => {
  it("질문은 수강권이 있는 수강생만 쓴다. 수강권이 없으면 목록도 볼 수 없다", async () => {
    expect(await code(ask(outsider))).toBe("NOT_LEARNER");
    expect(await code(listQuestions(t.db, outsider, { courseId }))).toBe("NOT_LEARNER");
    expect(await code(ask(operator))).toBe("STAFF_CANNOT_ASK");
    expect(await code(ask(instructor))).toBe("STAFF_CANNOT_ASK");
    expect(await code(ask(asker, { chapterKey: "no-such" }))).toBe("CHAPTER_NOT_FOUND");

    const id = await ask(asker);
    const list = await listQuestions(t.db, classmate, { courseId, chapterKey: "ch01" });
    expect(list.canAsk).toBe(true);
    expect(list.items).toMatchObject([
      { id, title: "응답이 비어 있어요", author: "묻는사람", view: "full", status: "open", answerCount: 0 },
    ]);
    expect((await listQuestions(t.db, operator, { courseId })).canAsk).toBe(false);
    expect(await openQuestionCount(t.db, courseId, "ch01")).toBe(1);

    // 수강 기간이 끝나면 더 쓸 수 없다
    await t.db
      .update(schema.entitlements)
      .set({ endsAt: new Date(Date.now() - 1000) })
      .where(eq(schema.entitlements.userId, classmate.userId));
    expect(await code(answerQuestion(deps(), classmate, id, { body: "저도요" }))).toBe("NOT_LEARNER");
  });

  it("비밀글은 질문자 · 그 과정 강사 · 운영자만 보고, 다른 수강생에게는 🔒 만 보인다 (검색에도 안 걸린다)", async () => {
    const id = await ask(asker, { title: "결제한 카드 번호가 보여요", body: "내 계정 문제", secret: true });
    const mate = await listQuestions(t.db, classmate, { courseId });
    expect(mate.items).toMatchObject([{ id, view: "locked", title: null, author: "", isSecret: true }]);
    expect(await code(questionDetail(t.db, classmate, id))).toBe("CANNOT_SEE");
    expect((await listQuestions(t.db, classmate, { courseId, q: "카드 번호" })).items).toEqual([]);
    expect((await listQuestions(t.db, classmate, { courseId, q: "계정" })).items).toEqual([]);
    expect(await code(answerQuestion(deps(), classmate, id, { body: "?" }))).toBe("CANNOT_SEE");
    expect(
      await code(reportPost(t.db, classmate, { targetType: "question", targetId: id, reason: "기타" })),
    ).toBe("CANNOT_SEE");

    for (const v of [asker, instructor, operator]) {
      const detail = await questionDetail(t.db, v, id);
      expect(detail.question).toMatchObject({ title: "결제한 카드 번호가 보여요", isSecret: true });
    }
    expect((await listQuestions(t.db, asker, { courseId, q: "카드 번호" })).items).toHaveLength(1);
    // 강사가 답하면 질문자만 알림을 받는다
    await answerQuestion(deps(), instructor, id, { body: "1:1 문의로 알려 주세요." });
    expect(await unreadCount(t.db, asker.userId)).toBe(1);
    expect(await unreadCount(t.db, classmate.userId)).toBe(0);
  });

  it("검색은 글자 그대로 찾는다 (% _ 는 와일드카드가 아니다)", async () => {
    await ask(asker, { title: "100% 진도가 안 올라가요" });
    await ask(asker, { title: "모델 이름" });
    expect((await listQuestions(t.db, classmate, { courseId, q: "100%" })).items).toHaveLength(1);
    expect((await listQuestions(t.db, classmate, { courseId, q: "%" })).items).toHaveLength(1);
    expect((await listQuestions(t.db, classmate, { courseId, q: "모델" })).items).toHaveLength(1);
  });
});

describe("질문 · 답변 · 해결됨 · 고정 · 알림", () => {
  it("API 키처럼 보이면 저장 전에 한 번 더 확인받는다 (막지는 않는다)", async () => {
    const error = await ask(asker, { body: `client = OpenAI(api_key="${KEY}")` }).catch((e: unknown) => e);
    expect(error).toMatchObject({
      status: 409,
      code: "SECRET_SUSPECTED",
      details: [{ kind: "OpenAI API 키", masked: "sk-proj-••••••" }],
    });
    expect(await t.db.select().from(schema.questions)).toHaveLength(0);
    const id = await ask(asker, { body: `client = OpenAI(api_key="${KEY}")`, confirmSecret: true });
    expect(await code(answerQuestion(deps(), classmate, id, { body: `제 키는 ${KEY}` }))).toBe(
      "SECRET_SUSPECTED",
    );

    // 잘못 올린 글은 지우면 내용이 남지 않는다
    await changeQuestion(t.db, asker, id, "delete");
    const [row] = await t.db.select().from(schema.questions).where(eq(schema.questions.id, id));
    expect(row).toMatchObject({ title: "", bodyMd: "" });
    expect(row!.deletedAt).not.toBeNull();
    expect((await listQuestions(t.db, asker, { courseId })).items).toEqual([]);
    expect(await code(questionDetail(t.db, asker, id))).toBe("DELETED");
  });

  it("수강생끼리 · 강사가 답하고, 강사 답변이 맨 위. 질문자가 해결됨, 강사가 고정", async () => {
    const first = await ask(asker);
    const second = await ask(asker, { title: "모델 이름을 바꾸면", chapterKey: "ch01" });
    await answerQuestion(deps(), classmate, first, { body: "max_tokens 를 확인해 보세요" });
    await answerQuestion(deps(), instructor, first, { body: "응답의 content[0].text 를 읽어야 합니다." });
    const detail = await questionDetail(t.db, asker, first);
    expect(detail.answers.map((a) => [a.authorRole, a.author])).toEqual([
      ["instructor", "가르치는사람"],
      ["learner", "같이듣는사람"],
    ]);
    expect(detail.can).toMatchObject({
      answer: true,
      resolve: true,
      pin: false,
      report: false,
      delete: true,
    });
    expect((await questionDetail(t.db, classmate, first)).can).toMatchObject({
      resolve: false,
      report: true,
    });

    expect(await code(changeQuestion(t.db, classmate, first, "resolve"))).toBe("NOT_AUTHOR");
    await changeQuestion(t.db, asker, first, "resolve");
    expect(await code(changeQuestion(t.db, asker, second, "pin"))).toBe("NOT_STAFF");
    await changeQuestion(t.db, instructor, second, "pin");
    const list = await listQuestions(t.db, classmate, { courseId });
    expect(list.items.map((i) => [i.id, i.pinned, i.status, i.answerCount, i.staffAnswered])).toEqual([
      [second, true, "open", 0, false],
      [first, false, "resolved", 2, true],
    ]);
    expect(
      (await listQuestions(t.db, classmate, { courseId, filter: "open" })).items.map((i) => i.id),
    ).toEqual([second]);
    expect((await listQuestions(t.db, classmate, { courseId, filter: "mine" })).items).toEqual([]);
    expect(await openQuestionCount(t.db, courseId, "ch01")).toBe(1);

    // 내 답변 지우기: 개수가 줄고 내용은 비운다
    const [mine] = await t.db
      .select()
      .from(schema.answers)
      .where(eq(schema.answers.authorId, classmate.userId));
    expect(await code(deleteAnswer(t.db, asker, mine!.id))).toBe("NOT_AUTHOR");
    await deleteAnswer(t.db, classmate, mine!.id);
    expect((await questionDetail(t.db, asker, first)).answers).toHaveLength(1);
    expect((await myQuestions(t.db, asker.userId)).map((q) => q.answerCount).sort()).toEqual([0, 1]);
  });

  it("새 답변 알림: 사이트 알림은 언제나, 메일은 설정을 따르고 읽지 않은 알림이 있으면 또 보내지 않는다", async () => {
    const id = await ask(asker);
    // 강사에게 새 질문 알림
    expect((await myNotifications(t.db, instructor.userId)).map((n) => n.kind)).toEqual(["qna_question"]);

    await answerQuestion(deps(), classmate, id, { body: "첫 답변" });
    await answerQuestion(deps(), instructor, id, { body: "강사 답변" });
    const list = await myNotifications(t.db, asker.userId);
    expect(list.map((n) => n.title)).toEqual([
      "강사 답변: 응답이 비어 있어요",
      "새 답변: 응답이 비어 있어요",
    ]);
    expect(list[0]!.url).toBe(`/learn/ai-agent-basics/ch01?qna=${id}`);
    expect(mails.filter((m) => m.template === "qna-answer")).toMatchObject([
      {
        to: "asker@example.com",
        fromStaff: false,
        url: `http://localhost:3000/learn/ai-agent-basics/ch01?qna=${id}`,
      },
    ]);

    // 열면 읽음 ➔ 다음 답변은 메일이 다시 간다. 남의 알림은 열 수 없다
    expect(await openNotification(t.db, asker.userId, list[0]!.id)).toBe(
      `/learn/ai-agent-basics/ch01?qna=${id}`,
    );
    expect(await code(openNotification(t.db, classmate.userId, list[1]!.id))).toBe("NOT_FOUND");
    await markAllRead(t.db, asker.userId);
    expect(await unreadCount(t.db, asker.userId)).toBe(0);
    await answerQuestion(deps(), classmate, id, { body: "하나 더" });
    expect(mails.filter((m) => m.template === "qna-answer")).toHaveLength(2);

    // 메일 끄기
    expect(await notificationPrefs(t.db, asker.userId)).toEqual({ qnaAnswerEmail: true, expiryEmail: true });
    await setNotificationPrefs(t.db, asker.userId, { qnaAnswerEmail: false });
    await markAllRead(t.db, asker.userId);
    await answerQuestion(deps(), instructor, id, { body: "또 답변" });
    expect(mails.filter((m) => m.template === "qna-answer")).toHaveLength(2);
    expect(await unreadCount(t.db, asker.userId)).toBe(1);
    // 내 질문에 내가 답해도 알림은 없다
    await answerQuestion(deps(), asker, id, { body: "해결했습니다" });
    expect(await unreadCount(t.db, asker.userId)).toBe(1);
  });
});

describe("신고 · 숨김 (AD-17)", () => {
  it("신고 ➔ 운영자가 숨김(사유) ➔ 다른 수강생에게서 사라지고 작성자에게 알림, 기록이 남는다", async () => {
    const id = await ask(asker, { title: "광고입니다", body: "싸게 팝니다" });
    expect(
      await code(reportPost(t.db, asker, { targetType: "question", targetId: id, reason: "스팸 · 광고" })),
    ).toBe("OWN_POST");
    expect(
      await reportPost(t.db, classmate, { targetType: "question", targetId: id, reason: "스팸 · 광고" }),
    ).toEqual({
      created: true,
    });
    expect(
      await reportPost(t.db, classmate, { targetType: "question", targetId: id, reason: "기타" }),
    ).toEqual({
      created: false,
    });
    expect((await questionDetail(t.db, classmate, id)).question.reported).toBe(true);
    const reported = await reportedPosts(t.db);
    expect(reported).toMatchObject([
      {
        targetType: "question",
        targetId: id,
        reasons: ["스팸 · 광고"],
        post: { title: "광고입니다", author: "묻는사람" },
      },
    ]);

    await moderatePost(t.db, {
      actorId: operator.userId,
      targetType: "question",
      targetId: id,
      hide: true,
      reason: "광고",
    });
    expect((await listQuestions(t.db, classmate, { courseId })).items).toEqual([]);
    expect(await code(questionDetail(t.db, classmate, id))).toBe("HIDDEN");
    // 작성자 · 운영자는 숨긴 이유와 함께 본다
    expect((await questionDetail(t.db, asker, id)).question).toMatchObject({
      hidden: true,
      hiddenReason: "광고",
    });
    expect((await listQuestions(t.db, operator, { courseId })).items).toMatchObject([{ id, hidden: true }]);
    expect(await reportedPosts(t.db)).toEqual([]);
    expect((await myNotifications(t.db, asker.userId)).map((n) => [n.kind, n.body])).toContainEqual([
      "qna_hidden",
      "사유: 광고",
    ]);
    expect(await openQuestionCount(t.db, courseId, "ch01")).toBe(0);
    const audit = await t.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "qna.hide"));
    expect(audit).toHaveLength(1);

    // 다시 보이게
    await moderatePost(t.db, {
      actorId: operator.userId,
      targetType: "question",
      targetId: id,
      hide: false,
      reason: "오해",
    });
    expect((await listQuestions(t.db, classmate, { courseId })).items).toHaveLength(1);
  });

  it("답변 신고 ➔ 문제없음으로 정리, 숨긴 답변은 다른 사람에게 내용이 보이지 않는다", async () => {
    const id = await ask(asker);
    const answerId = await answerQuestion(deps(), classmate, id, { body: "욕설" });
    await reportPost(t.db, asker, { targetType: "answer", targetId: answerId, reason: "욕설 · 비방" });
    expect(
      await dismissReports(t.db, { actorId: operator.userId, targetType: "answer", targetId: answerId }),
    ).toBe(1);
    expect(await reportedPosts(t.db)).toEqual([]);
    await moderatePost(t.db, {
      actorId: operator.userId,
      targetType: "answer",
      targetId: answerId,
      hide: true,
      reason: "욕설",
    });
    expect((await questionDetail(t.db, asker, id)).answers).toMatchObject([{ body: null, hidden: true }]);
    expect((await questionDetail(t.db, classmate, id)).answers).toMatchObject([
      { body: "욕설", hiddenReason: "욕설" },
    ]);
  });

  it("오래된 미답변: 답변 없이 3일 지난 질문", async () => {
    const id = await ask(asker);
    expect(await staleQuestions(t.db)).toEqual([]);
    expect(
      (await staleQuestions(t.db, new Date(Date.now() + 3 * 86_400_000 + 1000))).map((q) => q.id),
    ).toEqual([id]);
  });

  it("탈퇴한 회원의 질문은 남고 '탈퇴한 회원' 으로 보인다. 알림 · 알림 설정은 지운다", async () => {
    const id = await ask(asker);
    await answerQuestion(deps(), classmate, id, { body: "답변" });
    await setNotificationPrefs(t.db, classmate.userId, { expiryEmail: false });
    await answerQuestion(deps(), asker, id, { body: "감사합니다" });
    await withdrawUser(t.db, asker.userId);
    await withdrawUser(t.db, classmate.userId);
    const detail = await questionDetail(t.db, instructor, id);
    expect(detail.question.author).toBe("탈퇴한 회원");
    expect(detail.answers.map((a) => a.author)).toEqual(["탈퇴한 회원", "탈퇴한 회원"]);
    expect(
      await t.db.select().from(schema.notifications).where(eq(schema.notifications.userId, asker.userId)),
    ).toEqual([]);
    expect(await t.db.select().from(schema.notificationPrefs)).toEqual([]);
  });
});

describe("1:1 문의 (M-05 · AD-13)", () => {
  it("회원이 쓰면 운영자 목록에 ➔ 운영자가 열면 개인정보 조회 기록 ➔ 답변하면 알림 · 메일 ➔ 이어서 쓰기 ➔ 닫기", async () => {
    const id = await createInquiry(t.db, asker, {
      category: "결제 · 환불",
      title: "환불이 안 돼요",
      body: "결제 내역에 환불 버튼이 없습니다.",
    });
    expect(await code(inquiryForMember(t.db, classmate, id))).toBe("NOT_FOUND");
    expect((await adminInquiries(t.db, "open")).map((r) => [r.inquiry.id, r.nickname])).toEqual([
      [id, "묻는사람"],
    ]);

    const view = await inquiryForAdmin(t.db, { userId: operator.userId }, id);
    expect(view.messages.map((m) => [m.authorRole, m.body])).toEqual([
      ["member", "결제 내역에 환불 버튼이 없습니다."],
    ]);
    const pii = await t.db.select().from(schema.piiAccessLogs);
    expect(pii).toMatchObject([
      { actorId: operator.userId, subjectUserId: asker.userId, purpose: "1:1 문의 답변" },
    ]);

    await replyInquiry(deps(), { actorId: operator.userId, id, body: "7일이 지나 규정상 부분 환불입니다." });
    expect((await inquiryForMember(t.db, asker, id)).inquiry.status).toBe("answered");
    expect(await adminInquiries(t.db, "open")).toEqual([]);
    expect(mails).toMatchObject([
      {
        template: "inquiry-answer",
        to: "asker@example.com",
        url: `http://localhost:3000/my/inquiries/${id}`,
      },
    ]);
    expect((await myNotifications(t.db, asker.userId)).map((n) => [n.kind, n.url])).toEqual([
      ["inquiry_answer", `/my/inquiries/${id}`],
    ]);
    expect(
      await t.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "inquiry.reply")),
    ).toHaveLength(1);

    await addMemberMessage(t.db, asker, id, "그럼 얼마인가요?");
    expect((await inquiryForMember(t.db, asker, id)).inquiry.status).toBe("open");
    expect(await code(addMemberMessage(t.db, classmate, id, "끼어들기"))).toBe("NOT_FOUND");
    await replyInquiry(deps(), { actorId: operator.userId, id, body: "22,125원입니다.", close: true });
    const closed = await inquiryForMember(t.db, asker, id);
    expect(closed.inquiry.status).toBe("closed");
    expect(closed.messages).toHaveLength(4);
    expect(await code(addMemberMessage(t.db, asker, id, "하나 더"))).toBe("CLOSED");
    expect(await code(closeInquiryByMember(t.db, asker, id))).toBe("CLOSED");
  });

  it("문의 기록은 고치거나 지울 수 없고(DB), 탈퇴해도 남는다. 3년 지나면 정리 작업이 지운다", async () => {
    const id = await createInquiry(t.db, asker, { category: "기타", title: "문의", body: "내용" });
    await expect(t.db.execute(sql`update inquiry_messages set body = 'x'`)).rejects.toThrow();
    await expect(t.db.execute(sql`delete from inquiries`)).rejects.toThrow();
    await withdrawUser(t.db, asker.userId);
    expect((await adminInquiries(t.db, "all")).map((r) => [r.inquiry.id, r.nickname])).toEqual([[id, null]]);
    await purgeExpiredRecords(t.db);
    expect(await t.db.select().from(schema.inquiries)).toHaveLength(1);
    await purgeExpiredRecords(t.db, new Date(Date.now() + 3 * 366 * 86_400_000));
    expect(await t.db.select().from(schema.inquiries)).toHaveLength(0);
    expect(await t.db.select().from(schema.inquiryMessages)).toHaveLength(0);
  });
});

describe("공지 · 자주 묻는 질문 (AD-12)", () => {
  it("임시 저장은 운영자만 미리 보고, 게시하면 누구나 본다. 고쳐도 게시일은 그대로, 작업은 기록에 남는다", async () => {
    const id = await saveNotice(t.db, {
      actorId: operator.userId,
      title: "점검 안내",
      bodyMd: "11월 10일 새벽 점검",
      pinned: false,
      publish: false,
    });
    expect(await publishedNotices(t.db)).toEqual([]);
    expect(await noticeById(t.db, id)).toBeNull();
    expect(await noticeById(t.db, id, { includeDraft: true })).toMatchObject({ published: false });

    await saveNotice(t.db, {
      id,
      actorId: operator.userId,
      title: "점검 안내",
      bodyMd: "본문",
      pinned: true,
      publish: true,
    });
    const [first] = await publishedNotices(t.db);
    expect(first).toMatchObject({ id, pinned: true });
    await saveNotice(t.db, {
      id,
      actorId: operator.userId,
      title: "점검 안내 (수정)",
      bodyMd: "본문",
      pinned: true,
      publish: true,
    });
    const [again] = await publishedNotices(t.db);
    expect(again!.publishedAt).toEqual(first!.publishedAt);
    await deleteNotice(t.db, { id, actorId: operator.userId });
    expect(await publishedNotices(t.db)).toEqual([]);
    const actions = (await t.db.select().from(schema.auditLogs))
      .map((a) => a.action)
      .filter((a) => a.startsWith("notice"));
    expect(actions).toEqual(["notice.create", "notice.update", "notice.update", "notice.delete"]);
  });

  it("자주 묻는 질문은 분류 ➔ 순서대로, 숨긴 것은 보이지 않는다", async () => {
    await saveFaq(t.db, {
      actorId: operator.userId,
      category: "결제",
      question: "환불은?",
      answerMd: "7일",
      sortOrder: 2,
      published: true,
    });
    await saveFaq(t.db, {
      actorId: operator.userId,
      category: "결제",
      question: "영수증은?",
      answerMd: "메일",
      sortOrder: 1,
      published: true,
    });
    await saveFaq(t.db, {
      actorId: operator.userId,
      category: "결제",
      question: "준비 중",
      answerMd: "-",
      sortOrder: 0,
      published: false,
    });
    expect((await publishedFaqs(t.db)).map((f) => f.question)).toEqual(["영수증은?", "환불은?"]);
  });
});

describe("만료 알림과 알림 설정", () => {
  it("만료 알림 메일을 끄면 메일은 가지 않고 사이트 알림만 남는다", async () => {
    await setNotificationPrefs(t.db, asker.userId, { expiryEmail: false });
    const sent: MailJob[] = [];
    const result = await sendExpiryReminders(
      t.db,
      { enqueueMail: async (j) => void sent.push(j), baseUrl: "http://localhost:3000" },
      new Date(Date.now() + 61 * 86_400_000),
    );
    // 90일 수강권 둘: 30일쯤 남았을 때. 끈 사람은 메일 없이 사이트 알림만
    expect(result).toEqual({ d30: 1, d7: 0, skipped: 1 });
    expect(sent.map((m) => m.to)).toEqual(["mate@example.com"]);
    for (const v of [asker, classmate])
      expect((await myNotifications(t.db, v.userId)).map((n) => [n.kind, n.url])).toEqual([
        ["expiry", "/courses/ai-agent-basics"],
      ]);
  });
});
