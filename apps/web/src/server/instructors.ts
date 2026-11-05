// 강사 (M8): 강사 화면 권한(자기 과정만) · 강사 등록 · 계약 · 수익 비율(AD-15) · 검수 요청(I-05) ·
// 공개 프로필 · 정산 정보(I-09) · 대시보드(I-01) · 판매 · 수강 현황(I-07) · Q&A 목록(I-06).
// 강사에게는 수강생 개인정보(이메일 · 결제 정보 · 누가 샀는지)를 보여 주지 않는다 (사이트구조 1장, 8장).
import {
  canRequestReview,
  chapterFunnel,
  checkNewPolicy,
  contractState,
  coursePercent,
  isDeliverableEmail,
  isWaitingReview,
  kstDate,
  kstMonth,
  monthlySales,
  normalizeBankAccount,
  normalizeBusinessNo,
  normalizeEmail,
  normalizeRrn,
  progressDistribution,
  recentMonths,
  resolvePolicy,
} from "@aionit/core";
import { openPii, sealPii } from "@aionit/core/media";
import { loadPolicies } from "@aionit/payments";
import type { Db, TaxType } from "@aionit/db";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, or, schema, sql } from "@aionit/db";
import type { CourseInput, MailDeps } from "./courses";
import { CourseError, createCourse, updateCourse } from "./courses";
import { setRole } from "./members";
import { notify } from "./notifications";
import { recordPiiAccess, writeAudit } from "./records";
import type { Viewer } from "./viewer";

interface Actor {
  actorId: string;
  headers?: Headers | null;
}

type InstructorRow = typeof schema.instructors.$inferSelect;

// ---- 권한: 강사는 자기 과정만 ----

/** 이 회원의 강사 프로필 (강사 역할이 없거나 연결된 프로필이 없으면 null) */
export async function myInstructor(db: Db, viewer: Viewer): Promise<InstructorRow | null> {
  if (!viewer.roles.includes("instructor")) return null;
  const [row] = await db
    .select()
    .from(schema.instructors)
    .where(eq(schema.instructors.userId, viewer.userId));
  return row ?? null;
}

/**
 * 강사 화면 · API 의 첫 확인. write 면 이용 중(active)인 강사만 (정지 · 계약 끝난 강사는 보기만).
 * 강사 역할이 있어도 프로필이 연결되지 않았으면 들어갈 수 없다.
 */
export async function requireInstructor(
  db: Db,
  viewer: Viewer,
  options: { write?: boolean } = {},
): Promise<InstructorRow> {
  const row = await myInstructor(db, viewer);
  if (!row)
    throw new CourseError(
      "NO_INSTRUCTOR_PROFILE",
      "강사 프로필이 연결되지 않았습니다. 운영자에게 문의해 주세요.",
      403,
    );
  if (options.write && row.status !== "active")
    throw new CourseError(
      "INSTRUCTOR_INACTIVE",
      row.status === "suspended"
        ? "강사 활동이 정지되어 고칠 수 없습니다. 운영자에게 문의해 주세요."
        : "계약이 끝나 고칠 수 없습니다. 판매 · 수강 현황은 계속 볼 수 있습니다.",
      403,
    );
  return row;
}

/** 강사 본인의 과정. 남의 과정은 "없는 것"과 같이 404 (있는지도 알리지 않는다) */
export async function ownedCourse(
  db: Db,
  viewer: Viewer,
  courseId: string,
  options: { write?: boolean } = {},
) {
  const instructor = await requireInstructor(db, viewer, options);
  const [course] = await db
    .select()
    .from(schema.courses)
    .where(and(eq(schema.courses.id, courseId), eq(schema.courses.ownerInstructorId, instructor.id)));
  if (!course) throw new CourseError("NOT_FOUND", "과정을 찾을 수 없습니다.", 404);
  return { instructor, course };
}

export type CourseTarget = "course" | "version" | "video" | "slot" | "attachment";

/** 버전 · 영상 · 영상 자리 · 첨부가 어느 과정의 것인가 */
async function courseIdOf(db: Db, kind: CourseTarget, id: string): Promise<string | null> {
  const pick = async (table: "courseVersions" | "videoAssets" | "videoSlots" | "attachments") => {
    const t = schema[table];
    const [row] = await db.select({ courseId: t.courseId }).from(t).where(eq(t.id, id));
    return row?.courseId ?? null;
  };
  switch (kind) {
    case "course":
      return id;
    case "version":
      return pick("courseVersions");
    case "video":
      return pick("videoAssets");
    case "slot":
      return pick("videoSlots");
    case "attachment":
      return pick("attachments");
  }
}

/** 강사 API 공통: 이 대상이 내 과정의 것인지 확인하고 과정 id 를 돌려준다 */
export async function ownedTarget(
  db: Db,
  viewer: Viewer,
  kind: CourseTarget,
  id: string,
  options: { write?: boolean } = {},
) {
  const courseId = await courseIdOf(db, kind, id);
  if (!courseId) throw new CourseError("NOT_FOUND", "찾을 수 없습니다.", 404);
  return ownedCourse(db, viewer, courseId, options);
}

// ---- 과정 (I-02): 강사가 만들고 기본 정보를 고친다. 과정 ID · 강사 · 구독 포함 · 가격 · 공개는 운영자 몫 ----

export type InstructorCourseInput = Pick<
  CourseInput,
  "title" | "field" | "level" | "summary" | "descriptionMd" | "audienceMd" | "requirementsMd"
>;

export async function createOwnCourse(
  db: Db,
  viewer: Viewer,
  input: InstructorCourseInput & { slug: string; headers?: Headers | null },
) {
  const instructor = await requireInstructor(db, viewer, { write: true });
  const { headers, ...values } = input;
  return createCourse(db, {
    ...values,
    ownerInstructorId: instructor.id,
    inSubscription: true,
    actorId: viewer.userId,
    headers,
  });
}

export async function updateOwnCourse(
  db: Db,
  viewer: Viewer,
  courseId: string,
  input: InstructorCourseInput & { headers?: Headers | null },
) {
  const { course } = await ownedCourse(db, viewer, courseId, { write: true });
  const { headers, ...values } = input;
  await updateCourse(db, courseId, {
    ...values,
    ownerInstructorId: course.ownerInstructorId,
    inSubscription: course.inSubscription,
    actorId: viewer.userId,
    headers,
  });
}

// ---- 검수 요청 (I-05) ➔ 운영자 검수 (AD-04) ----

async function activeOperatorIds(db: Db): Promise<string[]> {
  const rows = await db
    .select({ userId: schema.userRoles.userId })
    .from(schema.userRoles)
    .innerJoin(schema.users, eq(schema.users.id, schema.userRoles.userId))
    .where(
      and(
        eq(schema.userRoles.role, "operator"),
        isNull(schema.userRoles.revokedAt),
        eq(schema.users.status, "active"),
      ),
    );
  return [...new Set(rows.map((r) => r.userId))];
}

/** 강사가 변경 내용 메모와 함께 검수를 요청한다. 운영자에게 사이트 알림 */
export async function requestReview(
  db: Db,
  viewer: Viewer,
  versionId: string,
  input: { note: string; headers?: Headers | null },
  now = new Date(),
) {
  const { course } = await ownedTarget(db, viewer, "version", versionId, { write: true });
  const [version] = await db
    .select()
    .from(schema.courseVersions)
    .where(eq(schema.courseVersions.id, versionId));
  const report = version!.validationReport as { ok?: boolean } | null;
  if (!canRequestReview({ status: version!.status, validationOk: !!report?.ok }))
    throw new CourseError(
      "NOT_REQUESTABLE",
      version!.status === "in_review"
        ? "이미 검수를 요청했습니다."
        : "검사를 통과한 버전만 검수를 요청할 수 있습니다.",
      409,
    );
  const note = input.note.trim();
  await db.transaction(async (tx) => {
    await tx
      .update(schema.courseVersions)
      .set({
        status: "in_review",
        reviewRequestedAt: now,
        reviewRequestedBy: viewer.userId,
        reviewRequestNote: note,
      })
      .where(eq(schema.courseVersions.id, versionId));
    await writeAudit(tx, {
      actorId: viewer.userId,
      action: "content.review_request",
      targetType: "course_version",
      targetId: versionId,
      before: { status: version!.status },
      after: { status: "in_review", note },
      headers: input.headers,
    });
    for (const operatorId of await activeOperatorIds(db))
      if (operatorId !== viewer.userId)
        await notify(tx, {
          userId: operatorId,
          kind: "content_review",
          title: `검수 요청: ${course.title} v${version!.version}`,
          body: note || null,
          url: `/admin/courses/${course.id}/versions/${versionId}`,
          targetId: versionId,
        });
  });
}

/** 운영자 검수 대기 (AD-04 목록): 강사가 요청한 것 + 운영자가 올려 검사를 통과한 것, 오래 기다린 순 */
export async function reviewQueue(db: Db) {
  const rows = await db
    .select({
      id: schema.courseVersions.id,
      version: schema.courseVersions.version,
      status: schema.courseVersions.status,
      uploadedBy: schema.courseVersions.uploadedBy,
      requestedAt: schema.courseVersions.reviewRequestedAt,
      note: schema.courseVersions.reviewRequestNote,
      createdAt: schema.courseVersions.createdAt,
      courseId: schema.courses.id,
      courseTitle: schema.courses.title,
      publishedVersionId: schema.courses.publishedVersionId,
      instructor: schema.instructors.displayName,
      ownerUserId: schema.instructors.userId,
    })
    .from(schema.courseVersions)
    .innerJoin(schema.courses, eq(schema.courses.id, schema.courseVersions.courseId))
    .innerJoin(schema.instructors, eq(schema.instructors.id, schema.courses.ownerInstructorId))
    .where(inArray(schema.courseVersions.status, ["ready", "in_review"]));
  return rows
    .filter((r) => isWaitingReview(r))
    .map((r) => ({ ...r, waitingSince: r.requestedAt ?? r.createdAt }))
    .sort((a, b) => a.waitingSince.getTime() - b.waitingSince.getTime());
}

// ---- 강사 등록 · 상태 (AD-15) ----

async function memberByEmail(db: Db, email: string) {
  const [user] = await db
    .select({ id: schema.users.id, email: schema.users.email, status: schema.users.status })
    .from(schema.users)
    .where(eq(schema.users.email, normalizeEmail(email)));
  if (!user || user.status !== "active")
    throw new CourseError(
      "MEMBER_NOT_FOUND",
      "그 이메일로 가입한 회원이 없습니다. 먼저 가입해 달라고 안내한 뒤 다시 등록해 주세요.",
      404,
    );
  const [taken] = await db
    .select({ id: schema.instructors.id })
    .from(schema.instructors)
    .where(eq(schema.instructors.userId, user.id));
  if (taken) throw new CourseError("ALREADY_INSTRUCTOR", "이미 강사 프로필이 연결된 회원입니다.", 409);
  return user;
}

/** 회원을 강사 프로필에 잇고 강사 역할을 준다. 강사에게 사이트 알림 · 메일 */
async function connectMember(
  db: Db,
  mail: MailDeps | null,
  instructor: InstructorRow,
  user: { id: string; email: string },
  actor: Actor,
) {
  await db
    .update(schema.instructors)
    .set({ userId: user.id })
    .where(eq(schema.instructors.id, instructor.id));
  await setRole(db, {
    actorId: actor.actorId,
    userId: user.id,
    role: "instructor",
    grant: true,
    reason: `강사 등록: ${instructor.displayName}`,
    headers: actor.headers,
  });
  await writeAudit(db, {
    actorId: actor.actorId,
    action: "instructor.link",
    targetType: "instructor",
    targetId: instructor.id,
    after: { userId: user.id },
    headers: actor.headers,
  });
  await notify(db, {
    userId: user.id,
    kind: "instructor_contract",
    title: `강사로 등록되었습니다 (${instructor.displayName})`,
    url: "/instructor",
    targetId: instructor.id,
  });
  if (mail && isDeliverableEmail(user.email))
    await mail
      .enqueueMail({
        template: "instructor-notice",
        to: user.email,
        userId: user.id,
        kind: "registered",
        displayName: instructor.displayName,
        url: `${mail.baseUrl}/instructor`,
      })
      .catch((error: unknown) => console.error(`[instructor] 등록 메일 넣기 실패 ${instructor.id}`, error));
}

/** 강사 등록. 이메일을 주면 그 회원을 잇고 강사 역할을 준다 (없으면 프로필만: 운영자가 대신 올리는 강사) */
export async function registerInstructor(
  db: Db,
  mail: MailDeps | null,
  input: { displayName: string; email?: string | null } & Actor,
) {
  const user = input.email ? await memberByEmail(db, input.email) : null;
  const [row] = await db
    .insert(schema.instructors)
    .values({ displayName: input.displayName.trim() })
    .returning();
  await writeAudit(db, {
    actorId: input.actorId,
    action: "instructor.create",
    targetType: "instructor",
    targetId: row!.id,
    after: { displayName: row!.displayName },
    headers: input.headers,
  });
  if (user) await connectMember(db, mail, row!, user, input);
  return row!;
}

/** 프로필만 있던 강사(아직 가입 전)를 가입한 회원과 잇는다 */
export async function linkInstructorMember(
  db: Db,
  mail: MailDeps | null,
  instructorId: string,
  input: { email: string } & Actor,
) {
  const instructor = await loadInstructor(db, instructorId);
  if (instructor.userId) throw new CourseError("ALREADY_LINKED", "이미 회원과 이어진 강사입니다.", 409);
  const user = await memberByEmail(db, input.email);
  await connectMember(db, mail, instructor, user, input);
}

async function loadInstructor(db: Db, instructorId: string) {
  const [row] = await db.select().from(schema.instructors).where(eq(schema.instructors.id, instructorId));
  if (!row) throw new CourseError("NOT_FOUND", "강사를 찾을 수 없습니다.", 404);
  return row;
}

export const INSTRUCTOR_STATUS = {
  active: { label: "활동 중", tone: "done" },
  suspended: { label: "정지", tone: "danger" },
  ended: { label: "계약 끝남", tone: "muted" },
} as const;

/** 정지 · 계약 끝남 · 다시 활동. 정지 · 끝난 강사는 강사 화면에서 보기만 한다 (과정 · 판매는 그대로) */
export async function setInstructorStatus(
  db: Db,
  instructorId: string,
  input: { status: InstructorRow["status"]; reason: string } & Actor,
) {
  const before = await loadInstructor(db, instructorId);
  if (before.status === input.status) return;
  await db
    .update(schema.instructors)
    .set({ status: input.status })
    .where(eq(schema.instructors.id, instructorId));
  await writeAudit(db, {
    actorId: input.actorId,
    action: "instructor.status",
    targetType: "instructor",
    targetId: instructorId,
    before: { status: before.status },
    after: { status: input.status, reason: input.reason },
    headers: input.headers,
  });
}

// ---- 계약 (AD-15) ----

async function currentInstructorTerms(db: Db, now: Date) {
  const [row] = await db
    .select()
    .from(schema.policyDocuments)
    .where(
      and(
        eq(schema.policyDocuments.kind, "instructor_terms"),
        lte(schema.policyDocuments.effectiveFrom, now),
      ),
    )
    .orderBy(desc(schema.policyDocuments.effectiveFrom))
    .limit(1);
  if (!row) throw new Error("시행 중인 강사 이용약관이 없습니다");
  return row;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 계약 만들기: 기간 + 지금 시행 중인 강사 이용약관. 강사에게 동의 요청 (사이트 알림 + 메일) */
export async function createContract(
  db: Db,
  mail: MailDeps | null,
  instructorId: string,
  input: { startsOn: string; endsOn: string | null; memo: string } & Actor,
  now = new Date(),
) {
  const instructor = await loadInstructor(db, instructorId);
  if (!DATE.test(input.startsOn) || (input.endsOn && !DATE.test(input.endsOn)))
    throw new CourseError("BAD_DATE", "날짜를 확인해 주세요.");
  if (input.endsOn && input.endsOn < input.startsOn)
    throw new CourseError("BAD_PERIOD", "끝나는 날은 시작하는 날 뒤여야 합니다.");
  const terms = await currentInstructorTerms(db, now);
  const [row] = await db
    .insert(schema.instructorContracts)
    .values({
      instructorId,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      policyDocumentId: terms.id,
      memo: input.memo.trim(),
      createdBy: input.actorId,
    })
    .returning();
  await writeAudit(db, {
    actorId: input.actorId,
    action: "contract.create",
    targetType: "instructor",
    targetId: instructorId,
    after: { contractId: row!.id, startsOn: input.startsOn, endsOn: input.endsOn, terms: terms.version },
    headers: input.headers,
  });
  if (instructor.userId) {
    await notify(db, {
      userId: instructor.userId,
      kind: "instructor_contract",
      title: "강사 계약에 동의해 주세요",
      body: `${input.startsOn} ~ ${input.endsOn ?? ""}`,
      url: "/instructor/profile#contract",
      targetId: row!.id,
    });
    const [user] = await db
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, instructor.userId));
    if (mail && isDeliverableEmail(user?.email))
      await mail
        .enqueueMail({
          template: "instructor-notice",
          to: user.email,
          userId: instructor.userId,
          kind: "contract",
          displayName: instructor.displayName,
          url: `${mail.baseUrl}/instructor/profile#contract`,
        })
        .catch((error: unknown) => console.error(`[instructor] 계약 메일 넣기 실패 ${row!.id}`, error));
  }
  return row!;
}

/** 동의 전 계약만 지운다 (잘못 만든 것). 동의한 계약은 DB 가 막는다 */
export async function removeContract(db: Db, contractId: string, actor: Actor) {
  const [row] = await db
    .select()
    .from(schema.instructorContracts)
    .where(eq(schema.instructorContracts.id, contractId));
  if (!row) throw new CourseError("NOT_FOUND", "계약을 찾을 수 없습니다.", 404);
  if (row.signedAt) throw new CourseError("SIGNED", "강사가 동의한 계약은 지울 수 없습니다.", 409);
  await db.delete(schema.instructorContracts).where(eq(schema.instructorContracts.id, contractId));
  await writeAudit(db, {
    actorId: actor.actorId,
    action: "contract.remove",
    targetType: "instructor",
    targetId: row.instructorId,
    before: { contractId, startsOn: row.startsOn, endsOn: row.endsOn },
    headers: actor.headers,
  });
}

/** 강사가 계약 · 강사 이용약관에 동의 (I-09). 동의 기록(user_consents)도 남긴다 */
export async function signContract(
  db: Db,
  viewer: Viewer,
  contractId: string,
  input: { headers?: Headers | null },
  now = new Date(),
) {
  const instructor = await requireInstructor(db, viewer);
  const [row] = await db
    .select()
    .from(schema.instructorContracts)
    .where(
      and(
        eq(schema.instructorContracts.id, contractId),
        eq(schema.instructorContracts.instructorId, instructor.id),
      ),
    );
  if (!row) throw new CourseError("NOT_FOUND", "계약을 찾을 수 없습니다.", 404);
  if (row.signedAt) return;
  const ip = input.headers?.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  await db.transaction(async (tx) => {
    await tx
      .update(schema.instructorContracts)
      .set({ signedAt: now, signedBy: viewer.userId, signedIp: ip })
      .where(eq(schema.instructorContracts.id, contractId));
    await tx
      .insert(schema.userConsents)
      .values({ userId: viewer.userId, policyDocumentId: row.policyDocumentId, agreed: true, at: now, ip });
    await writeAudit(tx, {
      actorId: viewer.userId,
      action: "contract.sign",
      targetType: "instructor",
      targetId: instructor.id,
      after: { contractId },
      headers: input.headers,
    });
  });
}

export async function contractsOf(db: Db, instructorId: string) {
  return db
    .select({
      contract: schema.instructorContracts,
      termsTitle: schema.policyDocuments.title,
      termsVersion: schema.policyDocuments.version,
      termsBody: schema.policyDocuments.bodyMd,
    })
    .from(schema.instructorContracts)
    .innerJoin(
      schema.policyDocuments,
      eq(schema.policyDocuments.id, schema.instructorContracts.policyDocumentId),
    )
    .where(eq(schema.instructorContracts.instructorId, instructorId))
    .orderBy(desc(schema.instructorContracts.startsOn), desc(schema.instructorContracts.createdAt));
}

// ---- 수익 비율 (AD-15 계약 조건 · M9 정산이 쓴다). 고치지 않고 새 버전을 시행일과 함께 ----

const kstStart = (day: string) => new Date(`${day}T00:00:00+09:00`);

/** 이 강사의 단건 매출 비율을 새로 정한다. 시행일은 내일(KST) 이후: 이미 생긴 매출에 거꾸로 적용하지 않는다 */
export async function setInstructorRate(
  db: Db,
  instructorId: string,
  input: { singleRateBp: number; effectiveOn: string; note: string } & Actor,
  now = new Date(),
) {
  await loadInstructor(db, instructorId);
  if (!DATE.test(input.effectiveOn)) throw new CourseError("BAD_DATE", "시행일을 확인해 주세요.");
  if (input.effectiveOn <= kstDate(now))
    throw new CourseError(
      "PAST_DATE",
      "시행일은 내일 이후로 정해 주세요 (이미 생긴 매출에는 적용하지 않습니다).",
    );
  if (!Number.isInteger(input.singleRateBp) || input.singleRateBp < 0 || input.singleRateBp > 10000)
    throw new CourseError("BAD_RATE", "비율은 0 ~ 100% 로 적어 주세요.");
  const effectiveFrom = kstStart(input.effectiveOn);
  // 강사에게 불리한 변경(비율 내림)은 30일 뒤부터 (M9, 강사 이용약관 3)
  const current = resolvePolicy(await loadPolicies(db), { instructorId }, effectiveFrom);
  const check = checkNewPolicy(
    {
      effectiveFrom,
      current: current && {
        singleRateBp: current.singleRateBp,
        poolRateBp: current.poolRateBp,
        pgFeeRateBp: current.pgFeeRateBp,
      },
      next: { singleRateBp: input.singleRateBp },
    },
    now,
  );
  if (check.block === "NEEDS_NOTICE")
    throw new CourseError(
      "NEEDS_NOTICE",
      "비율을 내리는 변경은 30일 뒤부터 시행할 수 있습니다 (강사 이용약관 3: 불리한 변경은 30일 전에 알림).",
    );
  const [same] = await db
    .select({ id: schema.revenuePolicies.id })
    .from(schema.revenuePolicies)
    .where(
      and(
        eq(schema.revenuePolicies.scope, "instructor"),
        eq(schema.revenuePolicies.scopeId, instructorId),
        eq(schema.revenuePolicies.effectiveFrom, effectiveFrom),
      ),
    );
  if (same)
    throw new CourseError("SAME_DATE", "그 시행일의 비율이 이미 있습니다. 다른 날로 정해 주세요.", 409);
  const [row] = await db
    .insert(schema.revenuePolicies)
    .values({
      scope: "instructor",
      scopeId: instructorId,
      singleRateBp: input.singleRateBp,
      effectiveFrom,
      note: input.note.trim(),
      createdBy: input.actorId,
    })
    .returning();
  await writeAudit(db, {
    actorId: input.actorId,
    action: "revenue_policy.create",
    targetType: "instructor",
    targetId: instructorId,
    after: { policyId: row!.id, singleRateBp: input.singleRateBp, effectiveOn: input.effectiveOn },
    headers: input.headers,
  });
  return row!;
}

/** 기본 정책 + 이 강사의 비율 버전 (시행일 순). current 는 지금 시행 중인 단건 비율 */
export async function ratesOf(db: Db, instructorId: string, now = new Date()) {
  const rows = await db
    .select()
    .from(schema.revenuePolicies)
    .where(
      or(
        eq(schema.revenuePolicies.scope, "default"),
        and(eq(schema.revenuePolicies.scope, "instructor"), eq(schema.revenuePolicies.scopeId, instructorId)),
      ),
    )
    .orderBy(asc(schema.revenuePolicies.effectiveFrom));
  const inForce = (scope: "default" | "instructor") =>
    rows.filter((r) => r.scope === scope && r.effectiveFrom <= now && r.singleRateBp !== null).at(-1) ?? null;
  const own = inForce("instructor");
  const base = inForce("default");
  return {
    defaults: rows.filter((r) => r.scope === "default"),
    versions: rows.filter((r) => r.scope === "instructor"),
    current: own ?? base,
    currentIsDefault: !own,
    poolRateBp: base?.subscriptionPoolRateBp ?? null,
  };
}

// ---- 공개 프로필 · 정산 정보 (I-09) ----

export async function updateProfile(
  db: Db,
  viewer: Viewer,
  input: { displayName: string; bioMd: string; headers?: Headers | null },
) {
  const instructor = await requireInstructor(db, viewer, { write: true });
  const values = { displayName: input.displayName.trim(), bioMd: input.bioMd.trim() };
  await db.update(schema.instructors).set(values).where(eq(schema.instructors.id, instructor.id));
  await writeAudit(db, {
    actorId: viewer.userId,
    action: "instructor.profile",
    targetType: "instructor",
    targetId: instructor.id,
    before: { displayName: instructor.displayName },
    after: { displayName: values.displayName, bioLength: values.bioMd.length },
    headers: input.headers,
  });
}

export interface PayoutInput {
  taxType: TaxType;
  rrn?: string | null;
  businessNo?: string | null;
  bankName: string;
  bankAccount: string;
  accountHolder: string;
}

const PII = { rrn: "rrn", bankAccount: "bank-account" } as const;

/**
 * 정산 정보 저장. 주민등록번호 · 계좌번호는 감싸서 저장하고 원문은 돌려주지 않는다.
 * 고칠 때 주민등록번호를 비워 두면 전에 넣은 값을 그대로 쓴다 (화면에 원문을 다시 보여 주지 않으므로).
 */
export async function savePayoutProfile(
  db: Db,
  secret: string,
  viewer: Viewer,
  input: PayoutInput & { headers?: Headers | null },
) {
  const instructor = await requireInstructor(db, viewer, { write: true });
  const [existing] = await db
    .select()
    .from(schema.payoutProfiles)
    .where(eq(schema.payoutProfiles.instructorId, instructor.id));
  const bankAccount = normalizeBankAccount(input.bankAccount);
  if (!bankAccount) throw new CourseError("BAD_ACCOUNT", "계좌번호는 숫자 6 ~ 20자리로 적어 주세요.");
  if (input.bankName.trim().length < 2) throw new CourseError("BAD_BANK", "은행 이름을 적어 주세요.");
  if (input.accountHolder.trim().length < 2) throw new CourseError("BAD_HOLDER", "예금주를 적어 주세요.");
  let rrnSealed: string | null = null;
  let businessNo: string | null = null;
  if (input.taxType === "individual") {
    if (input.rrn) {
      const rrn = normalizeRrn(input.rrn);
      if (!rrn) throw new CourseError("BAD_RRN", "주민등록번호 13자리를 확인해 주세요.");
      rrnSealed = sealPii(secret, PII.rrn, rrn);
    } else if (existing?.rrnSealed) {
      rrnSealed = existing.rrnSealed;
    } else {
      throw new CourseError("NEED_RRN", "개인 강사는 원천징수에 주민등록번호가 필요합니다.");
    }
  } else {
    businessNo = input.businessNo ? normalizeBusinessNo(input.businessNo) : null;
    if (!businessNo) throw new CourseError("BAD_BUSINESS_NO", "사업자등록번호 10자리를 확인해 주세요.");
  }
  const values = {
    taxType: input.taxType,
    rrnSealed,
    businessNo,
    bankName: input.bankName.trim(),
    bankAccountSealed: sealPii(secret, PII.bankAccount, bankAccount),
    bankAccountLast4: bankAccount.slice(-4),
    accountHolder: input.accountHolder.trim(),
    updatedBy: viewer.userId,
  };
  await db
    .insert(schema.payoutProfiles)
    .values({ instructorId: instructor.id, ...values })
    .onConflictDoUpdate({ target: schema.payoutProfiles.instructorId, set: values });
  // 값은 남기지 않는다 (무엇을 바꿨는지만)
  await writeAudit(db, {
    actorId: viewer.userId,
    action: "payout.update",
    targetType: "instructor",
    targetId: instructor.id,
    before: existing ? { taxType: existing.taxType, bankName: existing.bankName } : null,
    after: { taxType: values.taxType, bankName: values.bankName, rrnChanged: !!input.rrn },
    headers: input.headers,
  });
}

/**
 * 정산 정보 요약 (끝 4자리만). 읽을 때마다 개인정보 조회 기록을 남긴다 (데이터모델 3.2).
 * 원문(주민등록번호 · 계좌번호)은 M9 지급 때 openPayoutAccount 로만 꺼낸다.
 */
export async function payoutSummary(db: Db, instructorId: string, reader: Actor & { purpose: string }) {
  const [row] = await db
    .select({ profile: schema.payoutProfiles, userId: schema.instructors.userId })
    .from(schema.payoutProfiles)
    .innerJoin(schema.instructors, eq(schema.instructors.id, schema.payoutProfiles.instructorId))
    .where(eq(schema.payoutProfiles.instructorId, instructorId));
  if (!row) return null;
  await recordPiiAccess(db, {
    actorId: reader.actorId,
    subjectUserId: row.userId,
    fields: ["payout_profile.masked"],
    purpose: reader.purpose,
    headers: reader.headers,
  });
  const p = row.profile;
  return {
    taxType: p.taxType,
    hasRrn: !!p.rrnSealed,
    businessNo: p.businessNo,
    bankName: p.bankName,
    bankAccountLast4: p.bankAccountLast4,
    accountHolder: p.accountHolder,
    updatedAt: p.updatedAt,
  };
}

/** 지급(M9)할 때만: 계좌번호 원문. 조회 기록을 남긴다 */
export async function openPayoutAccount(
  db: Db,
  secret: string,
  instructorId: string,
  reader: Actor & { purpose: string },
) {
  const [row] = await db
    .select({ profile: schema.payoutProfiles, userId: schema.instructors.userId })
    .from(schema.payoutProfiles)
    .innerJoin(schema.instructors, eq(schema.instructors.id, schema.payoutProfiles.instructorId))
    .where(eq(schema.payoutProfiles.instructorId, instructorId));
  if (!row) return null;
  await recordPiiAccess(db, {
    actorId: reader.actorId,
    subjectUserId: row.userId,
    fields: ["payout_profile.bank_account"],
    purpose: reader.purpose,
    headers: reader.headers,
  });
  return openPii(secret, PII.bankAccount, row.profile.bankAccountSealed);
}

// ---- 운영자 화면 (AD-15) ----

export async function adminInstructorList(db: Db, now = new Date()) {
  const rows = await db
    .select({
      instructor: schema.instructors,
      nickname: schema.users.nickname,
      courses: sql<number>`(select count(*)::int from courses c where c.owner_instructor_id = instructors.id)`,
    })
    .from(schema.instructors)
    .leftJoin(schema.users, eq(schema.users.id, schema.instructors.userId))
    .orderBy(asc(schema.instructors.displayName));
  const contracts = rows.length
    ? await db
        .select()
        .from(schema.instructorContracts)
        .where(
          inArray(
            schema.instructorContracts.instructorId,
            rows.map((r) => r.instructor.id),
          ),
        )
    : [];
  const today = kstDate(now);
  return rows.map((r) => {
    const mine = contracts
      .filter((c) => c.instructorId === r.instructor.id)
      .sort((a, b) => b.startsOn.localeCompare(a.startsOn));
    const latest = mine[0];
    return {
      ...r,
      contract: latest ? { ...latest, state: contractState(latest, today) } : null,
    };
  });
}

// ---- 대시보드 (I-01) · 판매 · 수강 현황 (I-07). 숫자만, 사람을 가리키는 값 없음 ----

async function staffUserIds(db: Db, instructorUserId: string | null): Promise<string[]> {
  const operators = await db
    .select({ userId: schema.userRoles.userId })
    .from(schema.userRoles)
    .where(and(eq(schema.userRoles.role, "operator"), isNull(schema.userRoles.revokedAt)));
  return [...new Set([...operators.map((o) => o.userId), ...(instructorUserId ? [instructorUserId] : [])])];
}

/** 미답변: 열려 있고, 지우거나 숨기지 않았고, 강사 · 운영자 답변이 아직 없는 질문 */
const unansweredSql = sql<boolean>`(${schema.questions.status} = 'open' and not exists (
  select 1 from answers a where a.question_id = ${schema.questions.id}
    and a.author_role in ('instructor', 'operator') and a.deleted_at is null
))`;

export async function myCourses(db: Db, instructor: InstructorRow) {
  const courses = await db
    .select()
    .from(schema.courses)
    .where(eq(schema.courses.ownerInstructorId, instructor.id))
    .orderBy(asc(schema.courses.sortOrder), desc(schema.courses.createdAt));
  const versions = courses.length
    ? await db
        .select()
        .from(schema.courseVersions)
        .where(
          inArray(
            schema.courseVersions.courseId,
            courses.map((c) => c.id),
          ),
        )
        .orderBy(desc(schema.courseVersions.createdAt))
    : [];
  return courses.map((course) => {
    const mine = versions.filter((v) => v.courseId === course.id);
    return {
      course,
      latest: mine[0] ?? null,
      published: mine.find((v) => v.id === course.publishedVersionId) ?? null,
      versions: mine,
    };
  });
}

export async function instructorDashboard(db: Db, instructor: InstructorRow, now = new Date()) {
  const courses = await myCourses(db, instructor);
  const courseIds = courses.map((c) => c.course.id);
  const month = kstMonth(now);
  const monthStart = new Date(`${month}-01T00:00:00+09:00`);
  if (courseIds.length === 0) return { courses, unanswered: 0, month, newLearners: 0, sales: 0, net: 0 };
  const staff = await staffUserIds(db, instructor.userId);
  const [unanswered] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.questions)
    .where(
      and(
        inArray(schema.questions.courseId, courseIds),
        isNull(schema.questions.deletedAt),
        isNull(schema.questions.hiddenAt),
        unansweredSql,
      ),
    );
  const [learners] = await db
    .select({ n: sql<number>`count(distinct ${schema.entitlements.userId})::int` })
    .from(schema.entitlements)
    .where(
      and(
        eq(schema.entitlements.scope, "course"),
        inArray(schema.entitlements.courseId, courseIds),
        gte(schema.entitlements.createdAt, monthStart),
        isNull(schema.entitlements.revokedAt),
        staff.length ? sql`${schema.entitlements.userId} not in ${staff}` : undefined,
      ),
    );
  const money = await salesOf(db, courseIds, monthStart);
  const [row] = monthlySales([month], money.sales, money.refunds);
  return {
    courses,
    unanswered: unanswered?.n ?? 0,
    month,
    newLearners: learners?.n ?? 0,
    sales: row!.sales,
    net: row!.net,
  };
}

/** 결제된 주문 항목(단건 · 연장권) 과 끝난 환불. 금액 · 시각만 꺼낸다 (누가 · 어떤 주문인지는 꺼내지 않는다) */
async function salesOf(db: Db, courseIds: string[], since: Date) {
  const sales = await db
    .select({ paidAt: schema.orders.paidAt, amount: schema.orderItems.paidAmount })
    .from(schema.orderItems)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.orderItems.orderId))
    .where(
      and(
        inArray(schema.orderItems.courseId, courseIds),
        isNotNull(schema.orders.paidAt),
        gte(schema.orders.paidAt, since),
      ),
    );
  const refunds = await db
    .select({ doneAt: schema.refunds.doneAt, amount: schema.refunds.approvedAmount })
    .from(schema.refunds)
    .innerJoin(schema.orderItems, eq(schema.orderItems.id, schema.refunds.orderItemId))
    .where(
      and(
        inArray(schema.orderItems.courseId, courseIds),
        eq(schema.refunds.status, "done"),
        gte(schema.refunds.doneAt, since),
      ),
    );
  return {
    sales: sales.map((s) => ({ paidAt: s.paidAt!, amount: s.amount })),
    refunds: refunds.map((r) => ({ doneAt: r.doneAt!, amount: r.amount ?? 0 })),
  };
}

/**
 * 판매 · 수강 현황 (I-07). 강사 본인 · 운영자의 학습은 뺀다.
 * 돌려주는 값은 모두 숫자 · 챕터 · 월이다. 수강생 id · 닉네임 · 이메일 · 주문 번호 · 결제 시각은 담지 않는다.
 */
export async function courseStats(db: Db, viewer: Viewer, courseId: string, now = new Date()) {
  const { instructor, course } = await ownedCourse(db, viewer, courseId);
  const staff = await staffUserIds(db, instructor.userId);
  const notStaff = (column: typeof schema.entitlements.userId | typeof schema.chapterProgress.userId) =>
    staff.length ? sql`${column} not in ${staff}` : undefined;
  const chapters = course.publishedVersionId
    ? await db
        .select({
          key: schema.chapters.chapterKey,
          label: schema.chapters.label,
          title: schema.chapters.title,
        })
        .from(schema.chapters)
        .where(eq(schema.chapters.courseVersionId, course.publishedVersionId))
        .orderBy(asc(schema.chapters.sortOrder))
    : [];
  const entitlements = await db
    .select({
      userId: schema.entitlements.userId,
      startsAt: schema.entitlements.startsAt,
      endsAt: schema.entitlements.endsAt,
    })
    .from(schema.entitlements)
    .where(
      and(
        eq(schema.entitlements.scope, "course"),
        eq(schema.entitlements.courseId, courseId),
        isNull(schema.entitlements.revokedAt),
        notStaff(schema.entitlements.userId),
      ),
    );
  const progress = await db
    .select({
      userId: schema.chapterProgress.userId,
      chapterKey: schema.chapterProgress.chapterKey,
      completedAt: schema.chapterProgress.completedAt,
    })
    .from(schema.chapterProgress)
    .where(and(eq(schema.chapterProgress.courseId, courseId), notStaff(schema.chapterProgress.userId)));

  // 사람마다 묶어 센 뒤에는 id 를 버린다
  const buyers = new Set(entitlements.map((e) => e.userId));
  const active = new Set(
    entitlements.filter((e) => e.startsAt <= now && (!e.endsAt || e.endsAt > now)).map((e) => e.userId),
  );
  const byLearner = new Map<string, { started: Set<string>; completed: Set<string> }>();
  for (const id of buyers) byLearner.set(id, { started: new Set(), completed: new Set() });
  for (const p of progress) {
    const entry = byLearner.get(p.userId) ?? { started: new Set<string>(), completed: new Set<string>() };
    entry.started.add(p.chapterKey);
    if (p.completedAt) entry.completed.add(p.chapterKey);
    byLearner.set(p.userId, entry);
  }
  const learners = [...byLearner.values()];
  const keys = chapters.map((c) => c.key);
  const funnel = chapterFunnel(keys, learners);
  const months = recentMonths(now, 6);
  const money = await salesOf(db, [courseId], new Date(`${months[0]}-01T00:00:00+09:00`));
  const monthStart = new Date(`${months.at(-1)}-01T00:00:00+09:00`);
  const [time] = await db
    .select({ sec: sql<number>`coalesce(sum(${schema.learningTimeDaily.effectiveSec}), 0)::int` })
    .from(schema.learningTimeDaily)
    .where(
      and(
        eq(schema.learningTimeDaily.courseId, courseId),
        gte(schema.learningTimeDaily.date, kstDate(monthStart)),
      ),
    );
  return {
    course: { id: course.id, title: course.title, slug: course.slug },
    learners: {
      total: learners.length,
      /** 단건 구매 · 운영자 발급 수강권 */
      enrolled: buyers.size,
      /** 지금 볼 수 있는 단건 수강권 */
      active: active.size,
      /** 단건 수강권 없이 구독으로 공부한 사람 */
      viaSubscription: learners.length - buyers.size,
    },
    progress: progressDistribution(learners.map((l) => coursePercent(keys, [...l.completed]))),
    chapters: funnel.rows.map((row) => {
      const c = chapters.find((ch) => ch.key === row.key)!;
      return { ...row, label: c.label, title: c.title };
    }),
    dropAfter: funnel.dropAfter,
    dropCount: funnel.dropCount,
    sales: monthlySales(months, money.sales, money.refunds),
    /** 이번 달 유효 학습 시간 (구독 배분의 근거, M9) */
    monthEffectiveSec: time?.sec ?? 0,
  };
}

export type CourseStats = Awaited<ReturnType<typeof courseStats>>;

// ---- Q&A 답변 (I-06): 내 강의의 질문, 미답변 먼저 ----

export type InstructorQnaFilter = "unanswered" | "open" | "all";

export async function instructorQuestions(
  db: Db,
  instructor: InstructorRow,
  filter: InstructorQnaFilter = "all",
) {
  const q = schema.questions;
  const rows = await db
    .select({
      id: q.id,
      title: q.title,
      chapterKey: q.chapterKey,
      status: q.status,
      isSecret: q.isSecret,
      pinned: sql<boolean>`${q.pinnedAt} is not null`,
      hidden: sql<boolean>`${q.hiddenAt} is not null`,
      answerCount: q.answerCount,
      unanswered: unansweredSql,
      createdAt: q.createdAt,
      courseTitle: schema.courses.title,
      courseSlug: schema.courses.slug,
    })
    .from(q)
    .innerJoin(schema.courses, eq(schema.courses.id, q.courseId))
    .where(
      and(
        eq(schema.courses.ownerInstructorId, instructor.id),
        isNull(q.deletedAt),
        filter === "unanswered" ? and(unansweredSql, isNull(q.hiddenAt)) : undefined,
        filter === "open" ? eq(q.status, "open") : undefined,
      ),
    )
    .orderBy(desc(unansweredSql), desc(sql`${q.status} = 'open'`), asc(q.createdAt))
    .limit(300);
  // 미답변은 오래 기다린 순, 나머지는 최근 순
  const waiting = rows.filter((r) => r.unanswered && !r.hidden);
  const rest = rows
    .filter((r) => !(r.unanswered && !r.hidden))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return [...waiting, ...rest];
}

/** 강사 공개 소개 (P-06 · 강의 상세의 강사 소개): 이름 · 소개 · 공개 강의만 */
export async function publicInstructor(db: Db, instructorId: string) {
  const [row] = await db
    .select({
      id: schema.instructors.id,
      displayName: schema.instructors.displayName,
      bioMd: schema.instructors.bioMd,
      status: schema.instructors.status,
    })
    .from(schema.instructors)
    .where(eq(schema.instructors.id, instructorId));
  if (!row) return null;
  const courses = await db
    .select({
      slug: schema.courses.slug,
      title: schema.courses.title,
      field: schema.courses.field,
      level: schema.courses.level,
      summary: schema.courses.summary,
    })
    .from(schema.courses)
    .where(and(eq(schema.courses.ownerInstructorId, instructorId), eq(schema.courses.status, "published")))
    .orderBy(asc(schema.courses.sortOrder));
  if (courses.length === 0) return null;
  return { instructor: { id: row.id, displayName: row.displayName, bioMd: row.bioMd }, courses };
}

/** 운영자 화면에서 강사 상세 (AD-15) */
export async function adminInstructor(db: Db, instructorId: string) {
  const [row] = await db
    .select({ instructor: schema.instructors, nickname: schema.users.nickname, email: schema.users.email })
    .from(schema.instructors)
    .leftJoin(schema.users, eq(schema.users.id, schema.instructors.userId))
    .where(eq(schema.instructors.id, instructorId));
  if (!row) return null;
  const courses = await db
    .select({ id: schema.courses.id, title: schema.courses.title, status: schema.courses.status })
    .from(schema.courses)
    .where(eq(schema.courses.ownerInstructorId, instructorId))
    .orderBy(asc(schema.courses.sortOrder));
  return { ...row, courses, contracts: await contractsOf(db, instructorId) };
}
