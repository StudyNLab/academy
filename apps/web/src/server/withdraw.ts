// 회원 탈퇴 (M-06, docs/데이터모델.md 4장)
// 개인정보(이메일 · 닉네임 · 사진)는 지우거나 알아볼 수 없게 바꾸고, 행은 'withdrawn' 으로 남긴다.
// 로그인 방식 · 세션 · 2단계 인증 · 남은 토큰은 지운다. 동의 기록 · 메일 기록은 남기되 IP · 주소를 지운다.
// 학습 기록(진도 · 시청 · 체크 · 신호 · 첨부 받기)은 지우고, 하루 학습 시간(정산 근거)은 누구인지만 지운다.
// 법으로 보관해야 하는 접속 기록(login_logs, 6개월)은 보관 기간이 끝나면 worker 가 지운다.
import { placeholderEmail } from "@aionit/core";
import type { Db } from "@aionit/db";
import { and, eq, isNull, schema } from "@aionit/db";
import { writeAudit } from "./records";

export async function withdrawUser(db: Db, userId: string, headers?: Headers | null): Promise<void> {
  await db.transaction(async (tx) => {
    const now = new Date();
    const updated = await tx
      .update(schema.users)
      .set({
        email: placeholderEmail("withdrawn", userId),
        emailVerified: false,
        nickname: null,
        nicknameChangedAt: null,
        image: null,
        age14ConfirmedAt: null,
        twoFactorEnabled: false,
        status: "withdrawn",
        withdrawnAt: now,
      })
      .where(and(eq(schema.users.id, userId), isNull(schema.users.withdrawnAt)))
      .returning({ id: schema.users.id });
    if (updated.length === 0) return; // 이미 탈퇴함

    await tx.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
    await tx.delete(schema.authAccounts).where(eq(schema.authAccounts.userId, userId));
    await tx.delete(schema.twoFactors).where(eq(schema.twoFactors.userId, userId));
    // 비밀번호 재설정 · 2단계 인증 진행 중 토큰은 값에 user id 가 들어 있다
    await tx.delete(schema.verifications).where(eq(schema.verifications.value, userId));
    await tx.update(schema.userConsents).set({ ip: null }).where(eq(schema.userConsents.userId, userId));
    await tx.update(schema.emailLogs).set({ toEmail: null }).where(eq(schema.emailLogs.toUserId, userId));
    // 학습 기록은 지운다. 하루 학습 시간은 정산 근거라 누구인지만 지우고 남긴다. 수강권은 회수 (결제 기록과 이어져 행은 남긴다)
    await tx.delete(schema.chapterProgress).where(eq(schema.chapterProgress.userId, userId));
    await tx.delete(schema.videoWatch).where(eq(schema.videoWatch.userId, userId));
    await tx.delete(schema.selfChecks).where(eq(schema.selfChecks.userId, userId));
    await tx.delete(schema.learningHeartbeats).where(eq(schema.learningHeartbeats.userId, userId));
    await tx.delete(schema.attachmentDownloads).where(eq(schema.attachmentDownloads.userId, userId));
    await tx
      .update(schema.learningTimeDaily)
      .set({ userId: null })
      .where(eq(schema.learningTimeDaily.userId, userId));
    await tx
      .update(schema.entitlements)
      .set({ revokedAt: now, revokeReason: "회원 탈퇴" })
      .where(and(eq(schema.entitlements.userId, userId), isNull(schema.entitlements.revokedAt)));
    await tx
      .update(schema.userRoles)
      .set({ revokedAt: now, reason: "회원 탈퇴" })
      .where(and(eq(schema.userRoles.userId, userId), isNull(schema.userRoles.revokedAt)));
    await writeAudit(tx, {
      actorId: userId,
      action: "user.withdraw",
      targetType: "user",
      targetId: userId,
      headers,
    });
  });
}
