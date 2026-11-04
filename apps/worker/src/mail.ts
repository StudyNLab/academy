// 메일 발송 작업. web 이 대기열(MAIL_QUEUE)에 넣은 일을 보내고 email_logs 에 남긴다.
import { isDeliverableEmail } from "@aionit/core";
import type { Db } from "@aionit/db";
import { schema } from "@aionit/db";
import type { MailJob, Mailer } from "@aionit/mail";
import { renderMail } from "@aionit/mail";

export async function sendMailJob(job: MailJob, deps: { db: Db; mailer: Mailer }): Promise<void> {
  const log = { toUserId: job.userId, toEmail: job.to, template: job.template };
  if (!isDeliverableEmail(job.to)) {
    await deps.db.insert(schema.emailLogs).values({ ...log, toEmail: null, status: "skipped" });
    return;
  }
  // 이 worker 가 모르는 문안(web 만 먼저 새 버전일 때)이면 빈 메일을 보내지 않고 다시 시도하게 둔다
  const rendered = renderMail(job) as ReturnType<typeof renderMail> | undefined;
  if (!rendered?.subject) throw new Error(`모르는 메일 문안: ${job.template}`);
  try {
    const { messageId } = await deps.mailer.send({ to: job.to, ...rendered });
    await deps.db.insert(schema.emailLogs).values({ ...log, status: "sent", providerMessageId: messageId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.db.insert(schema.emailLogs).values({ ...log, status: "failed", error: message.slice(0, 500) });
    throw error; // pg-boss 가 다시 시도한다
  }
}
