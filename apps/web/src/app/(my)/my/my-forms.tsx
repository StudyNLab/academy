"use client";

import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useState } from "react";
import { Button, Checkbox, Field, Notice, StatusDot } from "@aionit/ui";
import { PROVIDER_LABEL } from "@/components/social-buttons";
import { api, authApi, startSocial } from "@/lib/client-api";

export function NicknameForm({ current, nextChangeAt }: { current: string; nextChangeAt: string | null }) {
  const router = useRouter();
  const [nickname, setNickname] = useState(current);
  const [message, setMessage] = useState<{ tone: "done" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const result = await api<{ nickname: string }>("/me/nickname", { nickname });
    setBusy(false);
    if (!result.ok) return setMessage({ tone: "danger", text: result.error.message });
    setMessage({ tone: "done", text: `닉네임을 '${result.data.nickname}'(으)로 바꿨습니다.` });
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <Field
        label="닉네임"
        value={nickname}
        onChange={(e) => setNickname(e.target.value)}
        disabled={!!nextChangeAt}
        hint={
          nextChangeAt
            ? `${nextChangeAt} 부터 다시 바꿀 수 있습니다 (30일에 한 번).`
            : "30일에 한 번 바꿀 수 있습니다."
        }
      />
      <Button
        type="submit"
        variant="outline"
        disabled={busy || !!nextChangeAt || nickname === current}
        className="self-start"
      >
        닉네임 바꾸기
      </Button>
    </form>
  );
}

const LINK_ERRORS: Record<string, string> = {
  email_doesn_t_match: "가입한 이메일과 같은 이메일의 계정만 연결할 수 있습니다.",
  account_already_linked_to_different_user: "이미 다른 회원에게 연결된 계정입니다.",
};

export function LinkedAccounts({
  linked,
  available,
  linkError,
}: {
  linked: string[];
  available: ("google" | "kakao")[];
  linkError: string | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(
    linkError ? (LINK_ERRORS[linkError.toLowerCase()] ?? "연결하지 못했습니다. 다시 시도해 주세요.") : null,
  );
  const rows: { id: string; label: string }[] = [
    { id: "credential", label: "이메일 · 비밀번호" },
    { id: "google", label: PROVIDER_LABEL.google },
    { id: "kakao", label: PROVIDER_LABEL.kakao },
  ];

  async function unlink(providerId: string) {
    const result = await authApi("/unlink-account", { providerId });
    if (!result.ok) return setError(result.error.message);
    router.refresh();
  }

  async function link(provider: "google" | "kakao") {
    const failure = await startSocial(provider, { callbackURL: "/my", errorCallbackURL: "/my", link: true });
    if (failure) setError(failure.message);
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <ul className="m-0 flex list-none flex-col p-0">
        {rows.map((row) => {
          const isLinked = linked.includes(row.id);
          const canLink = row.id !== "credential" && available.includes(row.id as "google" | "kakao");
          if (!isLinked && !canLink) return null;
          return (
            <li
              key={row.id}
              className="flex min-h-14 items-center justify-between gap-4 border-b border-line"
            >
              <span className="flex flex-col gap-0.5">
                <span className="text-[15px] font-semibold">{row.label}</span>
                <StatusDot tone={isLinked ? "done" : "muted"}>{isLinked ? "연결됨" : "연결 안 됨"}</StatusDot>
              </span>
              {isLinked ? (
                row.id !== "credential" && linked.length > 1 ? (
                  <Button size="sm" variant="outline" onClick={() => unlink(row.id)}>
                    연결 끊기
                  </Button>
                ) : null
              ) : (
                <Button size="sm" variant="outline" onClick={() => link(row.id as "google" | "kakao")}>
                  연결하기
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      <p className="m-0 text-[13px] leading-[1.6] text-ink-2">
        구글 · 카카오 계정은 로그인한 상태에서 여기서 직접 연결합니다. 이메일이 같아도 로그인 화면에서
        자동으로 연결하지 않습니다 (다른 사람이 내 계정에 들어오는 것을 막기 위해).
      </p>
    </div>
  );
}

/** 메일 알림 설정 (사이트 알림은 언제나 남는다) */
export function NotificationPrefsForm({
  prefs,
}: {
  prefs: { qnaAnswerEmail: boolean; expiryEmail: boolean };
}) {
  const [value, setValue] = useState(prefs);
  const [message, setMessage] = useState<string | null>(null);

  async function change(key: keyof typeof prefs, next: boolean) {
    setValue((v) => ({ ...v, [key]: next }));
    const result = await api<typeof prefs>("/me/notification-prefs", { [key]: next });
    if (!result.ok) {
      setValue((v) => ({ ...v, [key]: !next }));
      return setMessage(result.error.message);
    }
    setMessage("알림 설정을 저장했습니다.");
  }

  return (
    <div className="flex flex-col gap-1">
      <Checkbox
        checked={value.qnaAnswerEmail}
        onChange={(e) => void change("qnaAnswerEmail", e.target.checked)}
      >
        내 질문에 답변이 달리면 메일로 알림
      </Checkbox>
      <Checkbox checked={value.expiryEmail} onChange={(e) => void change("expiryEmail", e.target.checked)}>
        수강 기간이 30일 · 7일 남으면 메일로 알림
      </Checkbox>
      <p className="m-0 text-[13px] text-ink-2">
        꺼도 사이트 알림(머리글의 알림)에는 남습니다. 결제 · 환불 · 구독 · 1:1 문의 답변 메일은 끌 수
        없습니다.
      </p>
      {message ? (
        <p role="status" className="m-0 text-[13px] text-ink-2">
          {message}
        </p>
      ) : null}
    </div>
  );
}

export function MarketingToggle({ agreed }: { agreed: boolean }) {
  const [value, setValue] = useState(agreed);
  const [message, setMessage] = useState<string | null>(null);

  async function onChange(next: boolean) {
    setValue(next);
    const result = await api("/me/marketing", { agreed: next });
    if (!result.ok) {
      setValue(!next);
      return setMessage(result.error.message);
    }
    setMessage(next ? "새 강의 · 할인 소식을 메일로 보내 드립니다." : "마케팅 메일을 보내지 않습니다.");
  }

  return (
    <div className="flex flex-col gap-2">
      <Checkbox checked={value} onChange={(e) => onChange(e.target.checked)}>
        [선택] 새 강의 · 할인 소식을 이메일로 받기
      </Checkbox>
      {message ? (
        <p role="status" className="m-0 text-[13px] text-ink-2">
          {message}
        </p>
      ) : null}
    </div>
  );
}
