// 지금 요청한 사람이 누구인지 (로그인 · 역할 · 2단계 인증). 화면과 API 가 함께 쓴다.
// 권한 검사는 여기와 API 에서 한다. 화면에서 버튼을 숨기는 것은 편의일 뿐이다 (docs/기술설계.md 3.2).
import { isPrivilegedSessionExpired } from "@aionit/core";
import type { Db, Role } from "@aionit/db";
import { and, eq, isNull, schema } from "@aionit/db";
import type { Auth } from "./auth";

export interface Viewer {
  userId: string;
  email: string;
  nickname: string;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  sessionId: string;
  sessionCreatedAt: Date;
  mfaVerifiedAt: Date | null;
  roles: Role[];
}

export async function activeRoles(db: Db, userId: string): Promise<Role[]> {
  const rows = await db
    .select({ role: schema.userRoles.role })
    .from(schema.userRoles)
    .where(and(eq(schema.userRoles.userId, userId), isNull(schema.userRoles.revokedAt)));
  return rows.map((row) => row.role);
}

export async function loadViewer(
  auth: Auth,
  db: Db,
  headers: Headers,
  now = new Date(),
): Promise<Viewer | null> {
  const result = await auth.api.getSession({ headers });
  if (!result) return null;
  const { user, session } = result;
  if (user.status !== "active") return null;
  const roles = await activeRoles(db, user.id);
  // 운영자 · 강사 세션은 로그인부터 12시간 (활동해도 늘지 않는다). 지나면 세션을 지운다.
  if (roles.length > 0 && isPrivilegedSessionExpired(session.createdAt, now)) {
    await db.delete(schema.sessions).where(eq(schema.sessions.id, session.id));
    return null;
  }
  return {
    userId: user.id,
    email: user.email,
    nickname: user.name,
    emailVerified: user.emailVerified,
    twoFactorEnabled: !!user.twoFactorEnabled,
    sessionId: session.id,
    sessionCreatedAt: session.createdAt,
    mfaVerifiedAt: (session as { mfaVerifiedAt?: Date | null }).mfaVerifiedAt ?? null,
    roles,
  };
}

export type StaffAccess = "ok" | "login" | "forbidden" | "setup_2fa" | "verify_2fa";

/**
 * 관리자(operator) · 강사(instructor) 화면에 들어갈 수 있나.
 * 역할 + 2단계 인증 켜짐 + **이 세션에서** OTP 통과, 셋 다 있어야 한다.
 * (구글 · 카카오 로그인은 OTP 를 거치지 않으므로, 그 세션으로 관리자 화면에 오면 OTP 를 한 번 더 받는다)
 */
export function staffAccess(viewer: Viewer | null, role: Role): StaffAccess {
  if (!viewer) return "login";
  if (!viewer.roles.includes(role)) return "forbidden";
  if (!viewer.twoFactorEnabled) return "setup_2fa";
  if (!viewer.mfaVerifiedAt) return "verify_2fa";
  return "ok";
}
