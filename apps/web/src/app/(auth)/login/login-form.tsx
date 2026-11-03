"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useState } from "react";
import { Button, Field, Notice } from "@aionit/ui";
import { OrDivider, SocialButtons } from "@/components/social-buttons";
import { authApi, startSocial } from "@/lib/client-api";

export function LoginForm({ next, providers }: { next: string; providers: ("google" | "kakao")[] }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const result = await authApi<{ twoFactorRedirect?: boolean }>("/sign-in/email", {
      email,
      password,
      callbackURL: "/login?verified=1",
    });
    if (!result.ok) {
      setBusy(false);
      setError(result.error.message);
      return;
    }
    if (result.data.twoFactorRedirect) {
      router.push(`/login/two-factor?next=${encodeURIComponent(next)}`);
      return;
    }
    // 머리글 등 서버 화면이 로그인 상태로 다시 그려지도록 새로 연다
    window.location.assign(next);
  }

  async function onSocial(provider: "google" | "kakao") {
    setError(null);
    setBusy(true);
    const failure = await startSocial(provider, { callbackURL: next, errorCallbackURL: "/login" });
    if (failure) {
      setBusy(false);
      setError(failure.message);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Field
        label="이메일"
        type="email"
        autoComplete="username"
        value={email}
        onChange={(e) => setEmail(e.target.value.trim())}
        required
      />
      <Field
        label="비밀번호"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      <Button type="submit" size="lg" disabled={busy || !email || !password} className="w-full">
        {busy ? "확인 중…" : "로그인"}
      </Button>
      <div className="flex flex-wrap justify-between gap-3 text-[15px]">
        <Link href="/forgot-password">비밀번호를 잊었나요?</Link>
        <Link href="/signup">회원가입</Link>
      </div>
      {providers.length > 0 ? (
        <>
          <OrDivider />
          <SocialButtons providers={providers} verb="로그인" onSelect={onSocial} disabled={busy} />
        </>
      ) : null}
    </form>
  );
}
