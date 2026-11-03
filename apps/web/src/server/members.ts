// 회원 정보 바꾸기 · 운영자 작업 (닉네임, 역할, 이용 정지). 운영자 작업은 모두 audit_logs 에 남긴다.
import { checkNickname, NICKNAME_MESSAGES, nextNicknameChangeAt, normalizeNickname } from "@aionit/core";
import type { Db, Role } from "@aionit/db";
import { and, eq, isNull, schema } from "@aionit/db";
import { isNicknameTaken } from "./consents";
import { writeAudit } from "./records";

export class MemberError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** 닉네임 바꾸기 (30일에 한 번) */
export async function changeNickname(
  db: Db,
  userId: string,
  input: string,
  now = new Date(),
): Promise<string> {
  const nickname = normalizeNickname(input);
  const problem = checkNickname(nickname);
  if (problem) throw new MemberError("INVALID_NICKNAME", NICKNAME_MESSAGES[problem]);
  const [user] = await db
    .select({ nickname: schema.users.nickname, changedAt: schema.users.nicknameChangedAt })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  if (!user) throw new MemberError("NOT_FOUND", "회원을 찾을 수 없습니다.");
  if (user.nickname === nickname) return nickname;
  const next = nextNicknameChangeAt(user.changedAt, now);
  if (next) throw new MemberError("TOO_SOON", NICKNAME_MESSAGES.too_soon);
  if (await isNicknameTaken(db, nickname, userId))
    throw new MemberError("NICKNAME_TAKEN", NICKNAME_MESSAGES.taken);
  try {
    await db
      .update(schema.users)
      .set({ nickname, nicknameChangedAt: now })
      .where(eq(schema.users.id, userId));
  } catch (error) {
    // 동시에 같은 닉네임을 고른 경우 (고유 색인)
    if ((error as { code?: string }).code === "23505") {
      throw new MemberError("NICKNAME_TAKEN", NICKNAME_MESSAGES.taken);
    }
    throw error;
  }
  return nickname;
}

/** 역할 주기 · 거두기 (운영자 작업) */
export async function setRole(
  db: Db,
  input: {
    actorId: string | null;
    userId: string;
    role: Role;
    grant: boolean;
    reason: string;
    headers?: Headers | null;
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [target] = await tx
      .select({ status: schema.users.status })
      .from(schema.users)
      .where(eq(schema.users.id, input.userId));
    if (!target || target.status === "withdrawn")
      throw new MemberError("NOT_FOUND", "회원을 찾을 수 없습니다.");
    const active = and(
      eq(schema.userRoles.userId, input.userId),
      eq(schema.userRoles.role, input.role),
      isNull(schema.userRoles.revokedAt),
    );
    const [current] = await tx.select({ id: schema.userRoles.id }).from(schema.userRoles).where(active);
    if (input.grant) {
      if (current) return;
      await tx.insert(schema.userRoles).values({
        userId: input.userId,
        role: input.role,
        grantedBy: input.actorId,
        reason: input.reason,
      });
    } else {
      if (!current) return;
      if (input.role === "operator" && input.actorId === input.userId) {
        throw new MemberError("SELF_REVOKE", "자기 자신의 운영자 권한은 거둘 수 없습니다.");
      }
      await tx
        .update(schema.userRoles)
        .set({ revokedAt: new Date(), revokedBy: input.actorId, reason: input.reason })
        .where(active);
    }
    // 역할이 바뀌면 세션 규칙(12시간 · 2단계 인증)이 달라지므로 다시 로그인하게 한다
    await tx.delete(schema.sessions).where(eq(schema.sessions.userId, input.userId));
    await writeAudit(tx, {
      actorId: input.actorId,
      action: input.grant ? "role.grant" : "role.revoke",
      targetType: "user",
      targetId: input.userId,
      before: { role: input.role, active: !!current },
      after: { role: input.role, active: input.grant, reason: input.reason },
      headers: input.headers,
    });
  });
}

/** 이용 정지 · 정지 풀기 (운영자 작업). 정지하면 모든 세션을 끝낸다. */
export async function setUserStatus(
  db: Db,
  input: {
    actorId: string;
    userId: string;
    status: "active" | "suspended";
    reason: string;
    headers?: Headers | null;
  },
): Promise<void> {
  if (input.actorId === input.userId) throw new MemberError("SELF", "자기 자신은 정지할 수 없습니다.");
  await db.transaction(async (tx) => {
    const [target] = await tx
      .select({ status: schema.users.status })
      .from(schema.users)
      .where(eq(schema.users.id, input.userId));
    if (!target || target.status === "withdrawn")
      throw new MemberError("NOT_FOUND", "회원을 찾을 수 없습니다.");
    if (target.status === input.status) return;
    await tx.update(schema.users).set({ status: input.status }).where(eq(schema.users.id, input.userId));
    if (input.status === "suspended") {
      await tx.delete(schema.sessions).where(eq(schema.sessions.userId, input.userId));
    }
    await writeAudit(tx, {
      actorId: input.actorId,
      action: input.status === "suspended" ? "user.suspend" : "user.unsuspend",
      targetType: "user",
      targetId: input.userId,
      before: { status: target.status },
      after: { status: input.status, reason: input.reason },
      headers: input.headers,
    });
  });
}
