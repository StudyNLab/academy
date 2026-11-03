// 메일 문안. 모든 메일은 글(text)과 HTML 두 가지로 보낸다.
// 받는 사람이 보는 문장은 쉬운 말로, 링크는 한 개만 둔다 (피싱으로 오해받지 않게).

export type MailJob =
  | { template: "verify-email"; to: string; userId: string | null; url: string }
  | { template: "reset-password"; to: string; userId: string | null; url: string }
  | { template: "password-changed"; to: string; userId: string | null }
  | { template: "signup-existing"; to: string; userId: string | null; loginUrl: string; resetUrl: string };

export type MailTemplate = MailJob["template"];

export interface RenderedMail {
  subject: string;
  text: string;
  html: string;
}

const SITE = "AIONIT";

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
  }
}
