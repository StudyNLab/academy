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
  try {
    const { messageId } = await deps.mailer.send({ to: job.to, ...renderMail(job) });
    await deps.db.insert(schema.emailLogs).values({ ...log, status: "sent", providerMessageId: messageId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.db.insert(schema.emailLogs).values({ ...log, status: "failed", error: message.slice(0, 500) });
    throw error; // pg-boss 가 다시 시도한다
  }
}
