// 강사 (개발계획 M8)
// 완료 기준: 강사는 자기 과정만 보인다 (권한) · 반려 사유가 강사에게 간다 · 판매 · 수강 현황에 구매자 정보가 보이지 않는다
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, schema } from "@aionit/db";
import type { MailJob } from "@aionit/mail";
import { createMemoryStore } from "@aionit/storage";
import { processCourseVersion } from "../../worker/src/content";
import { buildZip, courseJson, normalEntries } from "../../../packages/content/test/fixtures";
import { POST as adminVersionAction } from "@/app/api/v1/admin/versions/[id]/[action]/route";
import { POST as instructorUpdateCourse } from "@/app/api/v1/instructor/courses/[id]/route";
import { POST as instructorUpload } from "@/app/api/v1/instructor/courses/[id]/versions/route";
import { DELETE as instructorAttachmentDelete } from "@/app/api/v1/instructor/attachments/[id]/route";
import { POST as instructorRequestReview } from "@/app/api/v1/instructor/versions/[id]/request-review/route";
import { POST as instructorSlot } from "@/app/api/v1/instructor/video-slots/[id]/route";
import { GET as instructorVideo } from "@/app/api/v1/instructor/videos/[id]/route";
import { dashboardCounts } from "@/server/admin-queries";
import { adminCourseList, courseDetail } from "@/server/catalog";
import type { MailDeps } from "@/server/courses";
import {
  addAttachment,
  createCourse,
  publishVersion,
  rejectVersion,
  removeInstructor,
  uploadPackage,
} from "@/server/courses";
import { grantEntitlement } from "@/server/entitlements";
import {
  contractsOf,
  courseStats,
  createContract,
  createOwnCourse,
  instructorDashboard,
  instructorQuestions,
  myCourses,
  openPayoutAccount,
  ownedCourse,
  ownedTarget,
  payoutSummary,
  publicInstructor,
  ratesOf,
  registerInstructor,
  removeContract,
  requestReview,
  requireInstructor,
  reviewQueue,
  savePayoutProfile,
  setInstructorRate,
  setInstructorStatus,
  signContract,
  updateOwnCourse,
  updateProfile,
} from "@/server/instructors";
import { askQuestion, answerQuestion } from "@/server/qna";
import type { Viewer } from "@/server/viewer";
import { loadViewer, staffAccess } from "@/server/viewer";
import { Browser, createVerifiedUser, ORIGIN, resetDb, setupTestAuth, totpFromUri } from "./helpers";

const t = setupTestAuth();
const store = createMemoryStore();
afterAll(() => t.close());

const SECRET = process.env.BETTER_AUTH_SECRET!;
const mails: MailJob[] = [];
const mail: MailDeps = { enqueueMail: async (job) => void mails.push(job), baseUrl: "http://localhost:3000" };
const courseDeps = { db: t.db, store, enqueueContent: async () => undefined };

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

/** 과정 ID · 버전을 바꾼 시험 패키지 */
async function packageFor(slug: string, version = "0.2.0") {
  const entries = await normalEntries();
  entries[0] = { name: "course.json", data: JSON.stringify(courseJson({ course_id: slug, version })) };
  return buildZip(entries);
}

async function upload(courseId: string, slug: string, actorId: string, version = "0.2.0") {
  const row = await uploadPackage(courseDeps, {
    courseId,
    zip: await packageFor(slug, version),
    fileName: "pkg.zip",
    actorId,
  });
  await processCourseVersion({ db: t.db, store }, row.id);
  return row.id;
}

const courseValues = {
  field: "ai" as const,
  level: "초급",
  summary: "",
  descriptionMd: "",
  audienceMd: "",
  requirementsMd: "",
  inSubscription: true,
};

let operator: Viewer;
let teacherA: Viewer;
let teacherB: Viewer;
let learner: Viewer;
let classmate: Viewer;
let instructorA: string;
let instructorB: string;
let courseA: string;
let courseB: string;
let versionB: string;

beforeEach(async () => {
  await resetDb(t.db);
  mails.length = 0;
  store.objects.clear();
  const users = await t.db
    .insert(schema.users)
    .values([
      { email: "op@example.com", nickname: "운영하는사람", emailVerified: true },
      { email: "teacher-a@example.com", nickname: "가르치는사람", emailVerified: true },
      { email: "teacher-b@example.com", nickname: "다른강사", emailVerified: true },
      { email: "buyer@example.com", nickname: "산사람", emailVerified: true },
      { email: "mate@example.com", nickname: "같이듣는사람", emailVerified: true },
    ])
    .returning();
  await t.db.insert(schema.userRoles).values({ userId: users[0]!.id, role: "operator" });
  operator = viewerOf(users[0]!.id, ["operator"]);
  teacherA = viewerOf(users[1]!.id, ["instructor"]);
  teacherB = viewerOf(users[2]!.id, ["instructor"]);
  learner = viewerOf(users[3]!.id);
  classmate = viewerOf(users[4]!.id);
  const a = await registerInstructor(t.db, mail, {
    displayName: "홍길동",
    email: "teacher-a@example.com",
    actorId: operator.userId,
  });
  const b = await registerInstructor(t.db, mail, {
    displayName: "임꺽정",
    email: "Teacher-B@example.com",
    actorId: operator.userId,
  });
  instructorA = a.id;
  instructorB = b.id;
  courseA = (
    await createCourse(t.db, {
      ...courseValues,
      slug: "ai-agent-basics",
      title: "AI Agent 개발 · 초급",
      ownerInstructorId: instructorA,
      actorId: operator.userId,
    })
  ).id;
  courseB = (
    await createCourse(t.db, {
      ...courseValues,
      slug: "zero-trust-basics",
      title: "제로 트러스트 입문",
      ownerInstructorId: instructorB,
      actorId: operator.userId,
    })
  ).id;
  await publishVersion(t.db, await upload(courseA, "ai-agent-basics", operator.userId), {
    actorId: operator.userId,
  });
  versionB = await upload(courseB, "zero-trust-basics", operator.userId);
  mails.length = 0;
});

describe("강사 등록 (AD-15)", () => {
  it("가입한 회원의 이메일로 등록하면 강사 역할이 생기고 메일 · 알림이 간다. 없는 회원은 거절", async () => {
    const roles = await t.db
      .select()
      .from(schema.userRoles)
      .where(eq(schema.userRoles.userId, teacherA.userId));
    expect(roles.map((r) => r.role)).toEqual(["instructor"]);
    const notices = await t.db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, teacherA.userId));
    expect(notices.map((n) => n.kind)).toEqual(["instructor_contract"]);
    await expect(
      registerInstructor(t.db, mail, {
        displayName: "없는사람",
        email: "nobody@example.com",
        actorId: operator.userId,
      }),
    ).rejects.toMatchObject({ code: "MEMBER_NOT_FOUND" });
    await expect(
      registerInstructor(t.db, mail, {
        displayName: "또홍길동",
        email: "teacher-a@example.com",
        actorId: operator.userId,
      }),
    ).rejects.toMatchObject({ code: "ALREADY_INSTRUCTOR" });
    // 대신 올리는 강사(회원 없음)도 만들 수 있다
    const ghost = await registerInstructor(t.db, mail, { displayName: "외부강사", actorId: operator.userId });
    expect(ghost.userId).toBeNull();
    await removeInstructor(t.db, ghost.id, { actorId: operator.userId });
  });
});

describe("권한: 강사는 자기 과정만 (I-01 ~ I-07)", () => {
  it("남의 과정 · 버전 · 영상 자리 · 영상 · 첨부는 없는 것처럼 404, 목록에도 없다", async () => {
    expect((await ownedCourse(t.db, teacherA, courseA)).course.id).toBe(courseA);
    const notFound = { code: "NOT_FOUND", status: 404 };
    await expect(ownedCourse(t.db, teacherA, courseB)).rejects.toMatchObject(notFound);
    await expect(ownedTarget(t.db, teacherA, "version", versionB)).rejects.toMatchObject(notFound);
    const [slotB] = await t.db
      .select()
      .from(schema.videoSlots)
      .where(eq(schema.videoSlots.courseId, courseB));
    await expect(ownedTarget(t.db, teacherA, "slot", slotB!.id)).rejects.toMatchObject(notFound);
    const [videoB] = await t.db
      .insert(schema.videoAssets)
      .values({
        courseId: courseB,
        title: "B 영상",
        originalName: "b.mp4",
        sizeBytes: 10,
        originalKey: "videos/b",
      })
      .returning();
    await expect(ownedTarget(t.db, teacherA, "video", videoB!.id)).rejects.toMatchObject(notFound);
    const attachmentB = await addAttachment(
      { db: t.db, store },
      {
        courseId: courseB,
        chapterKey: null,
        title: "B 실습 파일",
        file: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0]),
        fileName: "b.zip",
        actorId: operator.userId,
      },
    );
    await expect(ownedTarget(t.db, teacherA, "attachment", attachmentB.id)).rejects.toMatchObject(notFound);
    await expect(ownedTarget(t.db, teacherB, "slot", slotB!.id)).resolves.toBeTruthy();

    const instructor = await requireInstructor(t.db, teacherA);
    const mine = await myCourses(t.db, instructor);
    expect(mine.map((c) => c.course.id)).toEqual([courseA]);
    await expect(courseStats(t.db, teacherA, courseB)).rejects.toMatchObject(notFound);
    await expect(
      updateOwnCourse(t.db, teacherA, courseB, { ...courseValues, title: "가로채기" }),
    ).rejects.toMatchObject(notFound);
    await expect(requestReview(t.db, teacherA, versionB, { note: "" })).rejects.toMatchObject(notFound);
  });

  it("강사 역할이 없거나 프로필이 이어지지 않았으면 들어갈 수 없다. 정지 · 계약 끝난 강사는 보기만", async () => {
    await expect(requireInstructor(t.db, learner)).rejects.toMatchObject({ status: 403 });
    // 역할만 있고 프로필이 없는 강사
    await expect(requireInstructor(t.db, viewerOf(classmate.userId, ["instructor"]))).rejects.toMatchObject({
      code: "NO_INSTRUCTOR_PROFILE",
    });
    // 운영자도 강사 화면에서는 강사로 이어진 프로필이 있어야 한다
    await expect(requireInstructor(t.db, operator)).rejects.toMatchObject({ status: 403 });

    await setInstructorStatus(t.db, instructorA, {
      status: "suspended",
      reason: "점검",
      actorId: operator.userId,
    });
    await expect(
      updateOwnCourse(t.db, teacherA, courseA, { ...courseValues, title: "정지 중" }),
    ).rejects.toMatchObject({ code: "INSTRUCTOR_INACTIVE" });
    await expect(updateProfile(t.db, teacherA, { displayName: "홍길동", bioMd: "" })).rejects.toMatchObject({
      code: "INSTRUCTOR_INACTIVE",
    });
    // 보기는 된다
    await expect(courseStats(t.db, teacherA, courseA)).resolves.toBeTruthy();
    await setInstructorStatus(t.db, instructorA, {
      status: "active",
      reason: "점검 끝",
      actorId: operator.userId,
    });
    await updateOwnCourse(t.db, teacherA, courseA, { ...courseValues, title: "AI Agent 개발 · 초급 (개정)" });
  });

  it("강사가 만든 과정은 강사 소유 · 작성 중 · 구독 포함 기본값. 강사는 구독 포함 · 강사를 바꿀 수 없다", async () => {
    const created = await createOwnCourse(t.db, teacherA, {
      ...courseValues,
      slug: "rag-basics",
      title: "RAG 입문",
    });
    expect(created).toMatchObject({ ownerInstructorId: instructorA, status: "draft", inSubscription: true });
    await t.db.update(schema.courses).set({ inSubscription: false }).where(eq(schema.courses.id, created.id));
    await updateOwnCourse(t.db, teacherA, created.id, { ...courseValues, title: "RAG 입문 (고침)" });
    const [after] = await t.db.select().from(schema.courses).where(eq(schema.courses.id, created.id));
    expect(after).toMatchObject({
      title: "RAG 입문 (고침)",
      inSubscription: false,
      ownerInstructorId: instructorA,
    });
  });

  it("Q&A 목록(I-06)은 내 강의 질문만, 미답변이 먼저", async () => {
    for (const v of [learner, classmate])
      await grantEntitlement(t.db, {
        actorId: operator.userId,
        userId: v.userId,
        courseId: courseA,
        days: 90,
        reason: "베타",
      });
    const qnaDeps = { db: t.db, enqueueMail: mail.enqueueMail, baseUrl: mail.baseUrl };
    const first = await askQuestion(qnaDeps, learner, {
      courseId: courseA,
      chapterKey: "ch01",
      title: "첫 질문",
      body: "내용",
      secret: false,
    });
    const second = await askQuestion(qnaDeps, classmate, {
      courseId: courseA,
      chapterKey: "ch02",
      title: "둘째 질문 (비밀)",
      body: "내용",
      secret: true,
    });
    // 수강생끼리 답한 것은 미답변으로 남는다
    await answerQuestion(qnaDeps, classmate, first, { body: "저도 궁금해요" });
    await answerQuestion(qnaDeps, teacherA, second, { body: "강사 답변" });
    const instructor = await requireInstructor(t.db, teacherA);
    const list = await instructorQuestions(t.db, instructor);
    expect(list.map((q) => [q.id, q.unanswered])).toEqual([
      [first, true],
      [second, false],
    ]);
    expect(list[1]).toMatchObject({ isSecret: true, title: "둘째 질문 (비밀)" });
    expect((await instructorQuestions(t.db, instructor, "unanswered")).map((q) => q.id)).toEqual([first]);
    // 다른 강사에게는 보이지 않는다
    expect(await instructorQuestions(t.db, await requireInstructor(t.db, teacherB))).toEqual([]);
    // 목록에 질문자 정보가 없다
    expect(Object.keys(list[0]!)).not.toContain("authorId");
    expect(JSON.stringify(list)).not.toContain(learner.userId);
    expect((await instructorDashboard(t.db, instructor)).unanswered).toBe(1);
  });
});

describe("강사 업로드 ➔ 검수 요청 ➔ 운영자 검수 (I-03 · I-05 · AD-04)", () => {
  it("검수 요청 전에는 운영자 대기에 없고, 반려 사유가 강사에게 사이트 알림 · 메일로 간다", async () => {
    const version = await upload(courseA, "ai-agent-basics", teacherA.userId, "0.3.0");
    const [ready] = await t.db
      .select()
      .from(schema.courseVersions)
      .where(eq(schema.courseVersions.id, version));
    expect(ready!.status).toBe("ready");
    // 운영자가 올린 버전(B)은 대기에 있고, 강사가 올리고 요청 전인 버전은 없다
    expect((await reviewQueue(t.db)).map((r) => r.id)).toEqual([versionB]);
    // 과정 목록(AD-02) · 대시보드의 검수 대기 수도 같은 규칙
    const waiting = async () =>
      Object.fromEntries((await adminCourseList(t.db)).map((c) => [c.id, c.waiting]));
    expect(await waiting()).toEqual({ [courseA]: 0, [courseB]: 1 });
    expect((await dashboardCounts(t.db)).reviews).toBe(1);

    await requestReview(t.db, teacherA, version, { note: "CH2 예제 수정" });
    expect(await waiting()).toEqual({ [courseA]: 1, [courseB]: 1 });
    expect((await dashboardCounts(t.db)).reviews).toBe(2);
    await expect(requestReview(t.db, teacherA, version, { note: "" })).rejects.toMatchObject({
      code: "NOT_REQUESTABLE",
    });
    const queue = await reviewQueue(t.db);
    expect(queue.map((r) => [r.id, r.note])).toEqual([
      [versionB, null],
      [version, "CH2 예제 수정"],
    ]);
    const opNotice = await t.db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, operator.userId));
    expect(opNotice.map((n) => n.title)).toEqual(["검수 요청: AI Agent 개발 · 초급 v0.3.0"]);

    await rejectVersion(
      t.db,
      version,
      { actorId: operator.userId, reason: "ch02_lab01 영상 연결이 필요합니다" },
      mail,
    );
    const notices = await t.db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, teacherA.userId));
    expect(notices.find((n) => n.kind === "content_review")).toMatchObject({
      title: "반려: AI Agent 개발 · 초급 v0.3.0",
      body: "사유: ch02_lab01 영상 연결이 필요합니다",
      url: `/instructor/courses/${courseA}/versions/${version}`,
    });
    expect(mails).toEqual([
      expect.objectContaining({
        template: "content-review",
        to: "teacher-a@example.com",
        result: "rejected",
        reason: "ch02_lab01 영상 연결이 필요합니다",
        url: `http://localhost:3000/instructor/courses/${courseA}/versions/${version}`,
      }),
    ]);
    // 강사 화면은 버전의 reviewNote 로 사유를 보여 준다
    const [rejected] = await t.db
      .select()
      .from(schema.courseVersions)
      .where(eq(schema.courseVersions.id, version));
    expect(rejected).toMatchObject({ status: "rejected", reviewNote: "ch02_lab01 영상 연결이 필요합니다" });

    // 영상을 연결하고 다시 요청 ➔ 공개 ➔ 강사에게 공개 알림
    await requestReview(t.db, teacherA, version, { note: "영상 연결함" });
    await publishVersion(t.db, version, { actorId: operator.userId }, mail);
    expect(mails.at(-1)).toMatchObject({ template: "content-review", result: "published" });
    const [course] = await t.db.select().from(schema.courses).where(eq(schema.courses.id, courseA));
    expect(course!.publishedVersionId).toBe(version);
  });

  it("운영자가 직접 올려 공개한 버전은 강사에게 알리지 않는다", async () => {
    const version = await upload(courseA, "ai-agent-basics", operator.userId, "0.4.0");
    await publishVersion(t.db, version, { actorId: operator.userId }, mail);
    expect(mails).toEqual([]);
  });
});

describe("판매 · 수강 현황 (I-07): 구매자 정보 없음", () => {
  async function paidItem(userId: string, amount: number, paidAt: Date) {
    const [product] = await t.db
      .insert(schema.products)
      .values({ type: "course", name: "AI Agent 개발 · 초급", accessDays: 365 })
      .returning();
    const [order] = await t.db
      .insert(schema.orders)
      .values({
        userId,
        status: "paid",
        totalAmount: amount,
        orderName: "AI Agent 개발 · 초급",
        expiresAt: paidAt,
        paidAt,
      })
      .returning();
    const vat = Math.round(amount / 11);
    const [item] = await t.db
      .insert(schema.orderItems)
      .values({
        orderId: order!.id,
        productId: product!.id,
        productType: "course",
        courseId: courseA,
        productName: "AI Agent 개발 · 초급",
        listPrice: amount,
        paidAmount: amount,
        supplyAmount: amount - vat,
        vatAmount: vat,
        accessDays: 365,
      })
      .returning();
    return { orderId: order!.id, itemId: item!.id };
  }

  it("숫자 · 챕터 · 월만 있고 수강생 id · 이메일 · 닉네임 · 주문 번호가 없다. 강사 · 운영자 학습은 빠진다", async () => {
    const now = new Date();
    const sold = await paidItem(learner.userId, 59_000, now);
    const refunded = await paidItem(classmate.userId, 44_250, now);
    await t.db.insert(schema.refunds).values({
      orderItemId: refunded.itemId,
      userId: classmate.userId,
      status: "done",
      calculation: {},
      requestedAmount: 44_250,
      approvedAmount: 44_250,
      reason: "단순 변심",
      doneAt: now,
    });
    for (const v of [learner, classmate])
      await grantEntitlement(t.db, {
        actorId: operator.userId,
        userId: v.userId,
        courseId: courseA,
        days: 90,
        reason: "구매",
      });
    // 진도: 산 사람은 ch01 끝 · ch02 시작, 같이 듣는 사람은 ch01 시작만. 강사 · 운영자 진도는 세지 않는다
    await t.db.insert(schema.chapterProgress).values([
      { userId: learner.userId, courseId: courseA, chapterKey: "ch01", completedAt: now },
      { userId: learner.userId, courseId: courseA, chapterKey: "ch02" },
      { userId: classmate.userId, courseId: courseA, chapterKey: "ch01" },
      { userId: teacherA.userId, courseId: courseA, chapterKey: "ch01", completedAt: now },
      { userId: operator.userId, courseId: courseA, chapterKey: "ch02", completedAt: now },
    ]);

    const stats = await courseStats(t.db, teacherA, courseA);
    expect(stats.learners).toEqual({ total: 2, enrolled: 2, active: 2, viaSubscription: 0 });
    expect(stats.progress.find((b) => b.label === "50 ~ 74%")!.count).toBe(1);
    expect(stats.progress.find((b) => b.label === "0%")!.count).toBe(1);
    expect(stats.chapters.map((c) => [c.key, c.started, c.completed])).toEqual([
      ["ch01", 2, 1],
      ["ch02", 1, 0],
    ]);
    expect(stats.sales.at(-1)).toMatchObject({ sales: 2, gross: 103_250, refunded: 44_250, net: 59_000 });

    const instructor = await requireInstructor(t.db, teacherA);
    const dashboard = await instructorDashboard(t.db, instructor);
    expect(dashboard).toMatchObject({ newLearners: 2, sales: 2, net: 59_000 });

    const secrets = [
      learner.userId,
      classmate.userId,
      "buyer@example.com",
      "mate@example.com",
      "산사람",
      "같이듣는사람",
      sold.orderId,
      sold.itemId,
      refunded.orderId,
      "단순 변심",
    ];
    for (const shown of [JSON.stringify(stats), JSON.stringify(dashboard)])
      for (const secret of secrets) expect(shown).not.toContain(secret);
  });
});

describe("계약 · 수익 비율 · 정산 정보 (AD-15 · I-09)", () => {
  it("운영자가 만든 계약에 강사가 동의하면 동의 기록이 남고, 그 뒤에는 고치거나 지울 수 없다", async () => {
    const contract = await createContract(t.db, mail, instructorA, {
      startsOn: "2026-11-01",
      endsOn: "2027-10-31",
      memo: "첫 계약",
      actorId: operator.userId,
    });
    expect(mails).toEqual([expect.objectContaining({ template: "instructor-notice", kind: "contract" })]);
    await expect(signContract(t.db, teacherB, contract.id, {})).rejects.toMatchObject({ code: "NOT_FOUND" });
    await signContract(t.db, teacherA, contract.id, {
      headers: new Headers({ "x-forwarded-for": "10.0.0.7" }),
    });
    const [row] = (await contractsOf(t.db, instructorA)).map((c) => c.contract);
    expect(row).toMatchObject({ signedBy: teacherA.userId, signedIp: "10.0.0.7" });
    const consents = await t.db
      .select()
      .from(schema.userConsents)
      .where(eq(schema.userConsents.userId, teacherA.userId));
    expect(consents).toEqual([
      expect.objectContaining({ policyDocumentId: row!.policyDocumentId, agreed: true }),
    ]);
    await expect(removeContract(t.db, contract.id, { actorId: operator.userId })).rejects.toMatchObject({
      code: "SIGNED",
    });
    await expect(
      t.db
        .update(schema.instructorContracts)
        .set({ memo: "몰래" })
        .where(eq(schema.instructorContracts.id, contract.id)),
    ).rejects.toThrow();
    // 동의 전 계약은 지울 수 있다
    const draft = await createContract(t.db, null, instructorA, {
      startsOn: "2027-11-01",
      endsOn: null,
      memo: "",
      actorId: operator.userId,
    });
    await removeContract(t.db, draft.id, { actorId: operator.userId });
  });

  it("수익 비율은 새 버전으로만, 시행일은 내일 이후. 그전까지는 기본 정책 60%", async () => {
    const now = new Date("2026-11-05T03:00:00Z");
    expect((await ratesOf(t.db, instructorA, now)).current).toMatchObject({ singleRateBp: 6000 });
    expect((await ratesOf(t.db, instructorA, now)).currentIsDefault).toBe(true);
    await expect(
      setInstructorRate(
        t.db,
        instructorA,
        { singleRateBp: 7000, effectiveOn: "2026-11-05", note: "", actorId: operator.userId },
        now,
      ),
    ).rejects.toMatchObject({ code: "PAST_DATE" });
    await setInstructorRate(
      t.db,
      instructorA,
      { singleRateBp: 7000, effectiveOn: "2026-11-06", note: "첫 계약 조건", actorId: operator.userId },
      now,
    );
    expect((await ratesOf(t.db, instructorA, now)).current!.singleRateBp).toBe(6000);
    const later = await ratesOf(t.db, instructorA, new Date("2026-11-05T15:00:00Z")); // KST 11.6 0시
    expect(later).toMatchObject({
      currentIsDefault: false,
      current: { singleRateBp: 7000 },
      poolRateBp: 5000,
    });
    const [policy] = later.versions;
    await expect(
      t.db
        .update(schema.revenuePolicies)
        .set({ singleRateBp: 9000 })
        .where(eq(schema.revenuePolicies.id, policy!.id)),
    ).rejects.toThrow();
  });

  it("주민등록번호 · 계좌번호는 감싸서 저장하고 끝 4자리만 보인다. 읽으면 조회 기록", async () => {
    await expect(
      savePayoutProfile(t.db, SECRET, teacherA, {
        taxType: "individual",
        bankName: "국민은행",
        bankAccount: "123-4567-8901",
        accountHolder: "홍길동",
      }),
    ).rejects.toMatchObject({ code: "NEED_RRN" });
    await savePayoutProfile(t.db, SECRET, teacherA, {
      taxType: "individual",
      rrn: "900101-1000000",
      bankName: "국민은행",
      bankAccount: "123-4567-8901",
      accountHolder: "홍길동",
    });
    const [raw] = await t.db
      .select()
      .from(schema.payoutProfiles)
      .where(eq(schema.payoutProfiles.instructorId, instructorA));
    const stored = JSON.stringify(raw);
    expect(stored).not.toContain("9001011000000");
    expect(stored).not.toContain("12345678901");
    expect(raw!.bankAccountLast4).toBe("8901");
    // 기록에도 값이 남지 않는다
    const audits = await t.db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, "payout.update"));
    expect(JSON.stringify(audits)).not.toContain("8901");

    // 고칠 때 주민등록번호를 비우면 전 값을 쓴다
    await savePayoutProfile(t.db, SECRET, teacherA, {
      taxType: "individual",
      bankName: "신한은행",
      bankAccount: "110222333444",
      accountHolder: "홍길동",
    });
    const summary = await payoutSummary(t.db, instructorA, {
      actorId: operator.userId,
      purpose: "강사 관리",
    });
    expect(summary).toMatchObject({
      taxType: "individual",
      hasRrn: true,
      bankName: "신한은행",
      bankAccountLast4: "3444",
    });
    expect(JSON.stringify(summary)).not.toContain("110222333444");
    expect(
      await openPayoutAccount(t.db, SECRET, instructorA, { actorId: operator.userId, purpose: "지급" }),
    ).toBe("110222333444");
    const logs = await t.db
      .select()
      .from(schema.piiAccessLogs)
      .where(eq(schema.piiAccessLogs.subjectUserId, teacherA.userId));
    expect(logs.map((l) => l.fields)).toEqual([["payout_profile.masked"], ["payout_profile.bank_account"]]);

    // 사업자는 검증 숫자가 맞는 사업자등록번호
    await expect(
      savePayoutProfile(t.db, SECRET, teacherB, {
        taxType: "business",
        businessNo: "123-45-67890",
        bankName: "국민은행",
        bankAccount: "1234567890",
        accountHolder: "임꺽정",
      }),
    ).rejects.toMatchObject({ code: "BAD_BUSINESS_NO" });
  });

  it("강의 상세의 강사 소개 · 강사 소개 화면(P-06)은 공개 프로필과 공개 강의만", async () => {
    await updateProfile(t.db, teacherA, { displayName: "홍길동", bioMd: "클라우드 보안 15년" });
    const detail = await courseDetail(t.db, "ai-agent-basics");
    expect(detail!.instructor).toMatchObject({ displayName: "홍길동", bioMd: "클라우드 보안 15년" });
    const page = await publicInstructor(t.db, instructorA);
    expect(page!.courses.map((c) => c.slug)).toEqual(["ai-agent-basics"]);
    expect(Object.keys(page!.instructor).sort()).toEqual(["bioMd", "displayName", "id"]);
    // 공개 강의가 없는 강사는 소개 화면도 없다
    expect(await publicInstructor(t.db, instructorB)).toBeNull();
  });
});

describe("API: 강사 API 는 자기 과정만, 운영자 API 는 강사에게 막힌다", () => {
  /** 가입 ➔ 강사 등록 ➔ 로그인 ➔ 2단계 인증까지 마친 강사의 가짜 브라우저 */
  async function instructorBrowser(email: string, nickname: string, displayName: string) {
    const user = await createVerifiedUser(t, { email, name: nickname });
    const row = await registerInstructor(t.db, null, { displayName, email, actorId: operator.userId });
    const browser = new Browser(t.auth);
    expect((await browser.call("POST", "/sign-in/email", user)).status).toBe(200);
    const enable = await browser.call("POST", "/two-factor/enable", { password: user.password });
    await browser.call("POST", "/two-factor/verify-totp", {
      code: totpFromUri(enable.body.totpURI as string),
    });
    const viewer = await loadViewer(t.auth, t.db, browser.headers());
    expect(staffAccess(viewer, "instructor")).toBe("ok");
    return { browser, instructorId: row.id };
  }

  const request = (browser: Browser, path: string, method: string, body?: unknown) =>
    new Request(`${ORIGIN}/api/v1${path}`, {
      method,
      headers: browser.headers(body === undefined ? {} : { "content-type": "application/json" }),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const params = <T>(value: T) => ({ params: Promise.resolve(value) });

  it("남의 과정 · 버전 · 자리 · 영상 · 첨부를 부르면 404, 내 것은 된다, 운영자 API 는 403", async () => {
    const c = await instructorBrowser("c@example.com", "세번째선생", "장길산");
    const [own] = await t.db
      .update(schema.courses)
      .set({ ownerInstructorId: c.instructorId })
      .where(eq(schema.courses.id, courseB))
      .returning();
    const notMine = { id: courseA };

    const update = (id: string) =>
      instructorUpdateCourse(
        request(c.browser, `/instructor/courses/${id}`, "POST", { ...courseValues, title: "고친 제목" }),
        params({ id }),
      );
    expect((await update(notMine.id)).status).toBe(404);
    expect((await update(own!.id)).status).toBe(200);

    // 남의 과정에 교재 올리기: 파일을 읽기 전에 막는다
    const form = new FormData();
    form.set("package", new File([new Uint8Array(await packageFor("ai-agent-basics", "9.9.9"))], "pkg.zip"));
    const headers = c.browser.headers();
    const uploadResponse = await instructorUpload(
      new Request(`${ORIGIN}/api/v1/instructor/courses/${courseA}/versions`, {
        method: "POST",
        headers,
        body: form,
      }),
      params({ id: courseA }),
    );
    expect(uploadResponse.status).toBe(404);
    expect(
      (await t.db.select().from(schema.courseVersions).where(eq(schema.courseVersions.version, "9.9.9")))
        .length,
    ).toBe(0);

    const [slotA] = await t.db
      .select()
      .from(schema.videoSlots)
      .where(eq(schema.videoSlots.courseId, courseA));
    const slotResponse = await instructorSlot(
      request(c.browser, `/instructor/video-slots/${slotA!.id}`, "POST", {
        url: "https://youtu.be/dQw4w9WgXcQ",
      }),
      params({ id: slotA!.id }),
    );
    expect(slotResponse.status).toBe(404);
    const [slotAfter] = await t.db
      .select()
      .from(schema.videoSlots)
      .where(eq(schema.videoSlots.id, slotA!.id));
    expect(slotAfter!.source).toBe("none");

    const [videoA] = await t.db
      .insert(schema.videoAssets)
      .values({
        courseId: courseA,
        title: "A 영상",
        originalName: "a.mp4",
        sizeBytes: 10,
        originalKey: "videos/a",
      })
      .returning();
    expect(
      (
        await instructorVideo(
          request(c.browser, `/instructor/videos/${videoA!.id}`, "GET"),
          params({ id: videoA!.id }),
        )
      ).status,
    ).toBe(404);

    const attachmentA = await addAttachment(
      { db: t.db, store },
      {
        courseId: courseA,
        chapterKey: null,
        title: "A 실습 파일",
        file: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0]),
        fileName: "a.zip",
        actorId: operator.userId,
      },
    );
    expect(
      (
        await instructorAttachmentDelete(
          request(c.browser, `/instructor/attachments/${attachmentA.id}`, "DELETE"),
          params({ id: attachmentA.id }),
        )
      ).status,
    ).toBe(404);
    expect(
      (await t.db.select().from(schema.attachments).where(eq(schema.attachments.id, attachmentA.id))).length,
    ).toBe(1);

    const [versionA] = await t.db
      .select()
      .from(schema.courseVersions)
      .where(eq(schema.courseVersions.courseId, courseA));
    expect(
      (
        await instructorRequestReview(
          request(c.browser, `/instructor/versions/${versionA!.id}/request-review`, "POST", { note: "" }),
          params({ id: versionA!.id }),
        )
      ).status,
    ).toBe(404);

    // 강사가 운영자 API 로 공개 · 반려를 부르면 403
    const publish = await adminVersionAction(
      request(c.browser, `/admin/versions/${versionB}/publish`, "POST", {}),
      params({ id: versionB, action: "publish" }),
    );
    expect(publish.status).toBe(403);
    const [stillB] = await t.db
      .select()
      .from(schema.courseVersions)
      .where(eq(schema.courseVersions.id, versionB));
    expect(stillB!.status).toBe("ready");

    // 남의 사이트에서 온 쓰기 요청은 막는다 (CSRF)
    const forged = new Request(`${ORIGIN}/api/v1/instructor/courses/${own!.id}`, {
      method: "POST",
      headers: c.browser.headers({ origin: "https://evil.example", "content-type": "application/json" }),
      body: JSON.stringify({ ...courseValues, title: "위조" }),
    });
    expect((await instructorUpdateCourse(forged, params({ id: own!.id }))).status).toBe(403);
  });
});
