// 메일 문안. 모든 메일은 글(text)과 HTML 두 가지로 보낸다.
// 받는 사람이 보는 문장은 쉬운 말로, 링크는 한 개만 둔다 (피싱으로 오해받지 않게).

export type MailJob =
  | { template: "verify-email"; to: string; userId: string | null; url: string }
  | { template: "reset-password"; to: string; userId: string | null; url: string }
  | { template: "password-changed"; to: string; userId: string | null }
  | { template: "signup-existing"; to: string; userId: string | null; loginUrl: string; resetUrl: string }
  | {
      template: "payment-receipt";
      to: string;
      userId: string | null;
      productName: string;
      listPrice: number;
      discountAmount: number;
      paidAmount: number;
      supplyAmount: number;
      vatAmount: number;
      /** ISO 시각 */
      paidAt: string;
      /** 수강 · 연장 끝나는 시각 (없으면 무제한) */
      accessUntil: string | null;
      /** 토스 카드 영수증 */
      receiptUrl: string | null;
      historyUrl: string;
    }
  | {
      template: "refund-done";
      to: string;
      userId: string | null;
      productName: string;
      amount: number;
      historyUrl: string;
    }
  | {
      template: "refund-rejected";
      to: string;
      userId: string | null;
      productName: string;
      note: string;
      historyUrl: string;
    }
  | {
      template: "expiry-reminder";
      to: string;
      userId: string | null;
      courseTitle: string;
      daysLeft: number;
      /** 끝나는 시각 (ISO, 다음 날 0시 KST) */
      endsAt: string;
      courseUrl: string;
    }
  | {
      template: "subscription-notice";
      to: string;
      userId: string | null;
      kind: "renewal" | "price_change" | "payment_failed" | "cancel_scheduled" | "ended";
      planName: string;
      amount: number;
      /** ISO: 갱신 결제일 · 새 가격 적용일 · 결제 실패 중 이용 기한(다음 날 0시) · 해지 예약 끝나는 시각 · 끝난 시각 */
      date: string;
      reason: string | null;
      url: string;
    };

export type MailTemplate = MailJob["template"];

export interface RenderedMail {
  subject: string;
  text: string;
  html: string;
}

const SITE = "AIONIT";

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;
/** 끝나는 시각(다음 날 0시 KST) ➔ 마지막 이용일 */
const lastDay = (iso: string) =>
  new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "long" }).format(
    new Date(new Date(iso).getTime() - 1),
  );
const kstTime = (iso: string) =>
  new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "long", timeStyle: "short" }).format(
    new Date(iso),
  );

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** 문단 + (선택) 버튼 하나로 된 단순한 메일 */
function layout(title: string, paragraphs: string[], action?: { label: string; url: string }): RenderedMail {
  const text = [title, "", ...paragraphs, ...(action ? ["", `${action.label}: ${action.url}`] : [])].join(
    "\n",
  );
  const html = `<!doctype html>
<html lang="ko"><body style="margin:0;background:#f6f5f1;font-family:'IBM Plex Sans KR',system-ui,sans-serif;color:#121a26">
<div style="max-width:560px;margin:0 auto;padding:40px 24px">
<p style="font-weight:700;letter-spacing:-0.04em;font-size:20px;margin:0 0 32px">${SITE}</p>
<h1 style="font-size:22px;margin:0 0 20px">${escapeHtml(title)}</h1>
${paragraphs.map((p) => `<p style="font-size:15px;line-height:1.7;margin:0 0 14px">${escapeHtml(p)}</p>`).join("\n")}
${
  action
    ? `<p style="margin:28px 0"><a href="${escapeHtml(action.url)}" style="display:inline-block;background:#18304f;color:#f6f5f1;padding:12px 22px;border-radius:2px;text-decoration:none;font-weight:600">${escapeHtml(action.label)}</a></p>
<p style="font-size:13px;line-height:1.6;color:#4a5361;margin:0">버튼이 열리지 않으면 이 주소를 붙여 넣으세요:<br>${escapeHtml(action.url)}</p>`
    : ""
}
<p style="font-size:13px;line-height:1.6;color:#4a5361;margin:32px 0 0;border-top:1px solid #dad7cf;padding-top:16px">이 메일은 발신 전용입니다. 직접 요청하지 않았다면 이 메일을 무시하세요.</p>
</div></body></html>`;
  return { subject: `[${SITE}] ${title}`, text, html };
}

export function renderMail(job: MailJob): RenderedMail {
  switch (job.template) {
    case "verify-email":
      return layout(
        "이메일 주소를 확인해 주세요",
        [
          "가입해 주셔서 감사합니다. 아래 버튼을 누르면 가입이 끝납니다.",
          "이 링크는 1시간 동안만 쓸 수 있습니다.",
        ],
        { label: "이메일 확인하기", url: job.url },
      );
    case "reset-password":
      return layout(
        "비밀번호를 다시 정해 주세요",
        [
          "비밀번호 재설정을 요청하셨습니다. 아래 버튼을 눌러 새 비밀번호를 정하세요.",
          "이 링크는 1시간 동안 한 번만 쓸 수 있습니다.",
        ],
        { label: "새 비밀번호 정하기", url: job.url },
      );
    case "password-changed":
      return layout("비밀번호가 바뀌었습니다", [
        "방금 계정의 비밀번호가 바뀌었고, 다른 기기의 로그인은 모두 끝냈습니다.",
        "직접 바꾼 것이 아니라면 바로 비밀번호 재설정을 하고 1:1 문의로 알려 주세요.",
      ]);
    case "signup-existing":
      // 가입 화면에서 이미 있는 이메일인지 알려 주지 않는다 (가입 여부 확인 공격 방지). 대신 주인에게 메일로 알린다.
      return layout(
        "이미 가입된 이메일입니다",
        [
          "누군가 이 이메일 주소로 가입을 시도했습니다. 이미 이 주소로 가입되어 있어 새 계정은 만들지 않았습니다.",
          `본인이라면 로그인하세요: ${job.loginUrl}`,
          "비밀번호가 기억나지 않으면 아래 버튼으로 다시 정할 수 있습니다.",
        ],
        { label: "비밀번호 다시 정하기", url: job.resetUrl },
      );
    case "payment-receipt":
      return layout(
        "결제가 끝났습니다",
        [
          `${job.productName} 결제가 끝났습니다. 결제 시각 ${kstTime(job.paidAt)}.`,
          job.discountAmount > 0
            ? `정가 ${won(job.listPrice)} − 할인 ${won(job.discountAmount)} = 결제 금액 ${won(job.paidAmount)} (공급가액 ${won(job.supplyAmount)} · 부가세 ${won(job.vatAmount)})`
            : `결제 금액 ${won(job.paidAmount)} (공급가액 ${won(job.supplyAmount)} · 부가세 ${won(job.vatAmount)})`,
          job.accessUntil ? `수강 기간: ${lastDay(job.accessUntil)} 까지` : "수강 기간: 무제한",
          ...(job.receiptUrl ? [`카드 영수증: ${job.receiptUrl}`] : []),
          "환불은 결제 내역에서 요청할 수 있습니다 (결제일부터 7일 이내 · 이용 전이면 전액).",
        ],
        { label: "결제 내역 보기", url: job.historyUrl },
      );
    case "refund-done":
      return layout(
        "환불이 끝났습니다",
        [
          `${job.productName} 의 환불 ${won(job.amount)} 을 원래 결제 수단으로 돌려드렸습니다.`,
          "카드사에 따라 실제로 돌려받기까지 3 ~ 7일(영업일)이 걸릴 수 있습니다. 이 강의의 수강권은 끝났고, 진도 기록은 남아 있습니다.",
        ],
        { label: "결제 내역 보기", url: job.historyUrl },
      );
    case "refund-rejected":
      return layout(
        "환불 요청을 처리하지 못했습니다",
        [
          `${job.productName} 의 환불 요청을 환불 규정에 따라 처리하지 못했습니다.`,
          `이유: ${job.note}`,
          "궁금한 점은 1:1 문의로 알려 주세요.",
        ],
        { label: "결제 내역 보기", url: job.historyUrl },
      );
    case "subscription-notice": {
      const day = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "long" }).format(
        new Date(job.date),
      );
      switch (job.kind) {
        case "renewal":
          return layout(
            "구독이 곧 자동으로 결제됩니다",
            [
              `${job.planName} 구독이 ${day} 에 ${won(job.amount)} 자동으로 결제됩니다.`,
              "계속 이용하지 않으려면 그 전에 구독 관리에서 해지를 예약하세요. 해지해도 이미 결제한 기간 끝까지 이용할 수 있습니다.",
            ],
            { label: "구독 관리", url: job.url },
          );
        case "price_change":
          return layout(
            "구독 가격이 바뀝니다",
            [`${job.planName} 구독 가격이 ${day} 결제분부터 바뀝니다.`, job.reason ?? ""],
            { label: "구독 관리", url: job.url },
          );
        case "payment_failed":
          return layout(
            "구독 자동결제에 실패했습니다",
            [
              `${job.planName} 구독의 ${won(job.amount)} 자동결제에 실패했습니다.${job.reason ? ` (${job.reason})` : ""}`,
              `${lastDay(job.date)} 까지는 지금처럼 이용할 수 있고, 그 사이 다시 결제를 시도합니다. 결제 수단을 바꾸면 바로 다시 결제합니다.`,
            ],
            { label: "결제 수단 바꾸기", url: job.url },
          );
        case "cancel_scheduled":
          return layout(
            "구독 해지가 예약되었습니다",
            [
              `${lastDay(job.date)} 까지는 지금처럼 이용할 수 있고, 그 뒤에는 자동결제가 되지 않습니다.`,
              "진도 기록은 지워지지 않습니다. 마음이 바뀌면 그 전에 구독 관리에서 해지를 취소할 수 있습니다.",
            ],
            { label: "구독 관리", url: job.url },
          );
        case "ended":
          return layout(
            "구독이 끝났습니다",
            [
              `${job.planName} 구독이 끝났습니다.`,
              job.reason ?? "진도 기록은 남아 있어 다시 구독하면 이어서 볼 수 있습니다.",
            ],
            { label: "다시 구독하기", url: job.url },
          );
      }
      break;
    }
    case "expiry-reminder":
      return layout(
        `수강 기간이 ${job.daysLeft}일 남았습니다`,
        [
          `${job.courseTitle} 의 수강 기간이 ${lastDay(job.endsAt)} 에 끝납니다.`,
          "기간이 끝나도 진도와 실습 체크는 남아 있고, 연장권을 사면 이어서 볼 수 있습니다.",
        ],
        { label: "강의 보기", url: job.courseUrl },
      );
  }
}
