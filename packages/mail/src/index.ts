// 메일 보내기 어댑터. 개발 · 테스트 서버는 Mailpit, 실오픈 때는 메일 발송 서비스의 SMTP 주소만 바꾼다.
import { createTransport } from "nodemailer";

export * from "./templates";

/** pg-boss 대기열 이름. web 이 넣고 worker 가 보낸다. */
export const MAIL_QUEUE = "mail.send";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<{ messageId: string | null }>;
}

export function createSmtpMailer(options: { url: string; from: string }): Mailer {
  const transport = createTransport(options.url);
  return {
    async send(message) {
      const info = await transport.sendMail({ from: options.from, ...message });
      return { messageId: info.messageId ?? null };
    },
  };
}

/** 테스트용: 보내지 않고 모아 둔다 */
export function createMemoryMailer(): Mailer & { sent: MailMessage[] } {
  const sent: MailMessage[] = [];
  return {
    sent,
    async send(message) {
      sent.push(message);
      return { messageId: `memory-${sent.length}` };
    },
  };
}
