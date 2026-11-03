"use client";

import Link from "next/link";
import type { FormEvent } from "react";
import { useState } from "react";
import { Button, Field, Notice } from "@aionit/ui";
import { PageTitle } from "@/components/page-title";
import { authApi } from "@/lib/client-api";

// A-04 비밀번호 재설정 요청. 가입한 이메일인지 알려 주지 않는다 (가입 여부 확인 공격 방지)
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await authApi("/request-password-reset", { email, redirectTo: "/reset-password" });
    setBusy(false);
    if (result.ok) setSent(true);
    else setError(result.error.message);
  }

  return (
    <>
      <PageTitle label="Reset password" title="비밀번호 재설정">
        <p className="m-0">가입한 이메일을 입력하면 새 비밀번호를 정하는 링크를 보내 드립니다.</p>
      </PageTitle>
      {sent ? (
        <div className="flex flex-col gap-6">
          <Notice tone="done" title="메일을 보냈습니다">
            가입한 이메일이라면 몇 분 안에 메일이 옵니다. 링크는 1시간 동안 한 번만 쓸 수 있습니다. 오지
            않으면 스팸 메일함도 확인해 주세요.
          </Notice>
          <Link href="/login">로그인으로 돌아가기</Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-6">
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <Field
            label="이메일"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value.trim())}
            required
          />
          <Button type="submit" size="lg" disabled={busy || !email} className="w-full">
            {busy ? "보내는 중…" : "재설정 링크 보내기"}
          </Button>
          <p className="m-0 text-[15px] text-ink-2">
            구글 · 카카오로 가입했다면 비밀번호가 없습니다. 그 방식으로 <Link href="/login">로그인</Link>
            하세요.
          </p>
        </form>
      )}
    </>
  );
}
