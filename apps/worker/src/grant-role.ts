// 서버 명령: 역할 주기 (처음 운영자를 만들 때). 그 뒤의 역할 변경은 관리자 화면(/admin/users)에서 한다.
//   pnpm --filter @aionit/worker grant-role <이메일> <operator|instructor> "<사유>"
//   서버: docker compose run --rm --no-deps worker pnpm --filter @aionit/worker grant-role …
import { createDb, eq, isNull, and, schema, sql, ROLES } from "@aionit/db";
import type { Role } from "@aionit/db";

const [email, role, reason = "서버 명령으로 지정"] = process.argv.slice(2);
if (!email || !role || !(ROLES as readonly string[]).includes(role)) {
  console.error("사용법: grant-role <이메일> <operator|instructor> [사유]");
  process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL 이 설정되지 않았습니다");

const { db, close } = createDb(url, { max: 1, quiet: true });
try {
  const [user] = await db
    .select({ id: schema.users.id, status: schema.users.status })
    .from(schema.users)
    .where(sql`lower(${schema.users.email}) = ${email.trim().toLowerCase()}`);
  if (!user || user.status !== "active")
    throw new Error("그 이메일로 가입한 이용 중인 회원이 없습니다 (먼저 가입 · 메일 인증)");
  await db.transaction(async (tx) => {
    const active = and(
      eq(schema.userRoles.userId, user.id),
      eq(schema.userRoles.role, role as Role),
      isNull(schema.userRoles.revokedAt),
    );
    if ((await tx.select().from(schema.userRoles).where(active)).length > 0) {
      console.warn("이미 그 역할이 있습니다");
      return;
    }
    await tx.insert(schema.userRoles).values({ userId: user.id, role: role as Role, reason });
    await tx.delete(schema.sessions).where(eq(schema.sessions.userId, user.id));
    await tx.insert(schema.auditLogs).values({
      actorId: null,
      action: "role.grant",
      targetType: "user",
      targetId: user.id,
      before: { role, active: false },
      after: { role, active: true, reason, via: "cli" },
    });
    console.warn(
      `역할을 주었습니다: ${role}. 그 회원은 다시 로그인한 뒤 2단계 인증을 켜야 관리 화면에 들어갑니다.`,
    );
  });
} finally {
  await close();
}
