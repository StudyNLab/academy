"use client";

import Link from "next/link";
import type { FormEvent } from "react";
import { useState } from "react";
import { Button, Field, Notice } from "@aionit/ui";
import { SvcIcon } from "@/components/icons";
import { authApi } from "@/lib/client-api";

// A-04 비밀번호 재설정 요청 (시안 #/forgot · #/reset-sent). 가입한 이메일인지 알려 주지 않는다 (가입 여부 확인 공격 방지)
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function request() {
    setBusy(true);
    setError(null);
    const result = await authApi("/request-password-reset", { email, redirectTo: "/reset-password" });
    setBusy(false);
    if (result.ok) setSent(true);
    else setError(result.error.message);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    await request();
  }

  if (sent)
    return (
      <>
        <h1>재설정 메일을 보냈습니다.</h1>
        <p className="auth-desc">가입한 이메일이라면 몇 분 안에 안내 메일이 옵니다.</p>
        <Notice tone="info" title="메일이 오지 않나요?">
          스팸 메일함을 확인하거나 잠시 뒤 다시 요청해 주세요. 링크는 1시간 동안 한 번만 쓸 수 있습니다.
        </Notice>
        <div className="mt-5 flex flex-col gap-3">
          <Button variant="outline" disabled={busy} className="full" onClick={() => void request()}>
            {busy ? "보내는 중…" : "메일 다시 요청"}
          </Button>
          <Link className="btn secondary full" href="/login">
            로그인으로 돌아가기 <SvcIcon name="arrow" />
          </Link>
        </div>
      </>
    );

  return (
    <>
      <h1>비밀번호를 잊으셨나요?</h1>
      <p className="auth-desc">가입한 이메일로 새 비밀번호를 정하는 링크를 보내 드립니다.</p>
      <form onSubmit={onSubmit} className="flex flex-col gap-[18px]">
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <Field
          label="가입한 이메일"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value.trim())}
          required
        />
        <Button type="submit" size="lg" disabled={busy || !email} className="full">
          {busy ? "보내는 중…" : "재설정 링크 보내기"}
          {busy ? null : <SvcIcon name="arrow" />}
        </Button>
        <p className="field-hint m-0">
          구글 · 카카오로 가입했다면 비밀번호가 없습니다. 그 방식으로 로그인하세요.
        </p>
      </form>
      <p className="auth-bottom">
        <Link href="/login">로그인으로 돌아가기</Link>
      </p>
    </>
  );
}
