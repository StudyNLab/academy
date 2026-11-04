"use client";

import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useState } from "react";
import { renderSVG } from "uqr";
import { checkPassword, PASSWORD_MESSAGES } from "@aionit/core";
import { Button, Field, Notice, StatusDot } from "@aionit/ui";
import { authApi } from "@/lib/client-api";

export function PasswordChangeForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "done" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const problem = checkPassword(next);
    if (problem) return setFieldError(PASSWORD_MESSAGES[problem]);
    setFieldError(null);
    setBusy(true);
    const result = await authApi("/change-password", {
      currentPassword: current,
      newPassword: next,
      revokeOtherSessions: true,
    });
    setBusy(false);
    if (!result.ok) {
      if (result.error.code === "WEAK_PASSWORD") return setFieldError(result.error.message);
      return setMessage({ tone: "danger", text: result.error.message });
    }
    setCurrent("");
    setNext("");
    setMessage({ tone: "done", text: "비밀번호를 바꿨습니다. 다른 기기의 로그인은 모두 끝냈습니다." });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <Field
        label="지금 비밀번호"
        type="password"
        autoComplete="current-password"
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
        required
      />
      <Field
        label="새 비밀번호"
        type="password"
        autoComplete="new-password"
        value={next}
        onChange={(e) => setNext(e.target.value)}
        hint="8자 이상. 흔한 비밀번호 · 이메일이나 닉네임이 들어간 비밀번호는 쓸 수 없습니다."
        error={fieldError}
        required
      />
      <Button type="submit" variant="outline" disabled={busy || !current || !next} className="self-start">
        비밀번호 바꾸기
      </Button>
    </form>
  );
}

type Step =
  | { kind: "idle" }
  | { kind: "scan"; uri: string; backupCodes: string[] }
  | { kind: "done"; backupCodes: string[] };

export function TwoFactorSettings({
  enabled,
  hasPassword,
  recentLogin,
  staff,
  next,
}: {
  enabled: boolean;
  /** 없으면(구글 · 카카오만) 비밀번호 대신 "로그인한 지 15분 안"으로 본인을 확인한다 */
  hasPassword: boolean;
  recentLogin: boolean;
  staff: boolean;
  next: string | null;
}) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const result = await authApi<{ totpURI: string; backupCodes: string[] }>("/two-factor/enable", {
      ...(hasPassword ? { password } : {}),
      issuer: "AIONIT",
    });
    setBusy(false);
    if (!result.ok) return setError(result.error.message);
    setPassword("");
    setStep({ kind: "scan", uri: result.data.totpURI, backupCodes: result.data.backupCodes });
  }

  async function confirm(event: FormEvent) {
    event.preventDefault();
    if (step.kind !== "scan") return;
    setError(null);
    setBusy(true);
    const result = await authApi("/two-factor/verify-totp", { code: code.replace(/\s/g, "") });
    setBusy(false);
    if (!result.ok) return setError(result.error.message);
    setStep({ kind: "done", backupCodes: step.backupCodes });
  }

  async function disable(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const result = await authApi("/two-factor/disable", hasPassword ? { password } : {});
    setBusy(false);
    if (!result.ok) return setError(result.error.message);
    setPassword("");
    router.refresh();
  }

  async function loginAgain() {
    await authApi("/sign-out");
    window.location.assign(
      `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`,
    );
  }

  // 비밀번호가 없는 계정: 로그인한 지 오래됐으면 다시 로그인부터
  if (!hasPassword && !recentLogin && step.kind === "idle") {
    return (
      <div className="flex flex-col gap-5">
        <StatusDot tone={enabled ? "done" : "muted"}>{enabled ? "켜져 있음" : "꺼져 있음"}</StatusDot>
        <p className="m-0 text-[15px] leading-[1.7] text-ink-2">
          구글 · 카카오로 가입한 계정은 비밀번호 대신 <strong className="text-ink">방금 로그인했는지</strong>
          로 본인을 확인합니다. 다시 로그인하면 15분 동안 2단계 인증을 {enabled ? "끌" : "켤"} 수 있습니다.
        </p>
        <Button variant="primary" onClick={() => void loginAgain()} className="self-start">
          다시 로그인하기
        </Button>
      </div>
    );
  }

  if (step.kind === "done") {
    return (
      <div className="flex flex-col gap-5">
        <Notice tone="done" title="2단계 인증을 켰습니다">
          {hasPassword
            ? "이제 로그인할 때 비밀번호 다음에 인증 앱의 코드를 입력합니다."
            : "이제 관리 화면에 들어갈 때 인증 앱의 코드를 입력합니다."}
        </Notice>
        <BackupCodes codes={step.backupCodes} />
        {next ? (
          <Button variant="primary" onClick={() => window.location.assign(next)} className="self-start">
            하던 일로 돌아가기
          </Button>
        ) : (
          <Button variant="outline" onClick={() => router.refresh()} className="self-start">
            확인
          </Button>
        )}
      </div>
    );
  }

  if (step.kind === "scan") {
    const svg = renderSVG(step.uri, { border: 2 });
    const secret = new URL(step.uri).searchParams.get("secret") ?? "";
    return (
      <form onSubmit={confirm} className="flex flex-col gap-5">
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <ol className="m-0 flex flex-col gap-2 pl-5 text-[15px] leading-[1.7]">
          <li>휴대폰의 인증 앱(Google Authenticator, Microsoft Authenticator 등)을 엽니다.</li>
          <li>아래 QR 코드를 찍거나, 찍을 수 없으면 비밀 키를 직접 입력합니다.</li>
          <li>앱에 나온 6자리 코드를 입력해 확인합니다.</li>
        </ol>
        {/* eslint-disable-next-line @next/next/no-img-element -- 직접 만든 SVG (외부 이미지 아님) */}
        <img
          src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`}
          alt="인증 앱에 등록할 QR 코드"
          width={200}
          height={200}
          className="bg-white"
        />
        <p className="m-0 text-[13px] text-ink-2">
          비밀 키: <code className="font-mono text-[13px] break-all text-ink">{secret}</code>
        </p>
        <Field
          label="인증 코드 (6자리)"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
        />
        <Button type="submit" disabled={busy || !code} className="self-start">
          확인하고 켜기
        </Button>
      </form>
    );
  }

  return enabled ? (
    <form onSubmit={disable} className="flex flex-col gap-5">
      <StatusDot tone="done">켜져 있음</StatusDot>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {staff ? (
        <Notice tone="warn">운영자 · 강사는 2단계 인증을 끄면 관리 화면에 들어갈 수 없습니다.</Notice>
      ) : null}
      {hasPassword ? (
        <Field
          label="끄려면 비밀번호 입력"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      ) : null}
      <Button
        type="submit"
        variant="outline"
        disabled={busy || (hasPassword && !password)}
        className="self-start"
      >
        2단계 인증 끄기
      </Button>
    </form>
  ) : (
    <form onSubmit={start} className="flex flex-col gap-5">
      <StatusDot tone="muted">꺼져 있음</StatusDot>
      <p className="m-0 text-[15px] leading-[1.7] text-ink-2">
        {hasPassword
          ? "비밀번호가 새어 나가도 내 휴대폰의 인증 앱 코드 없이는 로그인할 수 없게 합니다."
          : "구글 · 카카오 계정을 누가 알아내도 내 휴대폰의 인증 앱 코드 없이는 관리 화면에 들어갈 수 없게 합니다."}
        {staff ? " 운영자 · 강사는 꼭 켜야 합니다." : " 수강생은 선택입니다."}
      </p>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {hasPassword ? (
        <Field
          label="비밀번호 확인"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      ) : (
        <p className="m-0 text-[14px] text-ink-2">
          구글 · 카카오로 가입한 계정이라 비밀번호 대신 방금 로그인한 것으로 본인을 확인했습니다.
        </p>
      )}
      <Button type="submit" disabled={busy || (hasPassword && !password)} className="self-start">
        2단계 인증 켜기
      </Button>
    </form>
  );
}

function BackupCodes({ codes }: { codes: string[] }) {
  return (
    <div className="flex flex-col gap-3 border-t-2 border-warn bg-surface px-4 py-4">
      <p className="m-0 font-semibold">복구 코드 — 지금 안전한 곳에 적어 두세요</p>
      <p className="m-0 text-[14px] text-ink-2">
        휴대폰을 잃어버렸을 때 인증 코드 대신 한 번씩 쓸 수 있습니다. 이 화면을 닫으면 다시 볼 수 없습니다.
      </p>
      <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0 font-mono text-[14px]">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
    </div>
  );
}
