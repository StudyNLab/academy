"use client";

import Link from "next/link";
import type { FormEvent } from "react";
import { useState } from "react";
import { Button, Field, Notice } from "@aionit/ui";
import { authApi } from "@/lib/client-api";

export function TwoFactorForm({ next }: { next: string }) {
  const [code, setCode] = useState("");
  const [useBackup, setUseBackup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const result = await authApi(useBackup ? "/two-factor/verify-backup-code" : "/two-factor/verify-totp", {
      code: code.replace(/\s/g, ""),
    });
    if (!result.ok) {
      setBusy(false);
      setError(result.error.message);
      return;
    }
    window.location.assign(next);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {useBackup ? (
        <Field
          label="복구 코드"
          autoComplete="off"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          hint="2단계 인증을 켤 때 받아 둔 복구 코드 하나를 입력하세요. 한 번 쓴 코드는 다시 쓸 수 없습니다."
          required
        />
      ) : (
        <Field
          label="인증 코드 (6자리)"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]*"
          maxLength={7}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="[&_input]:font-mono [&_input]:text-[20px] [&_input]:tracking-[0.3em]"
          required
        />
      )}
      <Button type="submit" size="lg" disabled={busy || !code} className="w-full">
        {busy ? "확인 중…" : "확인"}
      </Button>
      <div className="flex flex-wrap justify-between gap-3 text-[15px]">
        <button
          type="button"
          className="min-h-11 border-0 bg-transparent p-0 text-link underline"
          onClick={() => {
            setUseBackup((v) => !v);
            setCode("");
            setError(null);
          }}
        >
          {useBackup ? "인증 앱 코드 쓰기" : "인증 앱을 쓸 수 없나요? 복구 코드 쓰기"}
        </button>
        <Link href="/login">처음부터 다시 로그인</Link>
      </div>
    </form>
  );
}
