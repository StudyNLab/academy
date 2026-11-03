"use client";

import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useState } from "react";
import { checkPassword, PASSWORD_MESSAGES } from "@aionit/core";
import { Button, Field, Notice } from "@aionit/ui";
import { authApi } from "@/lib/client-api";

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const problem = checkPassword(password);
    if (problem) return setFieldError(PASSWORD_MESSAGES[problem]);
    if (password !== confirm) return setFieldError("두 비밀번호가 같지 않습니다.");
    setFieldError(null);
    setBusy(true);
    const result = await authApi("/reset-password", { token, newPassword: password });
    setBusy(false);
    if (!result.ok) {
      if (result.error.code === "WEAK_PASSWORD") setFieldError(result.error.message);
      else setError(result.error.message);
      return;
    }
    router.push("/login?reset=1");
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Field
        label="새 비밀번호"
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        hint="8자 이상. 흔한 비밀번호는 쓸 수 없습니다."
        error={fieldError}
        required
      />
      <Field
        label="새 비밀번호 확인"
        type="password"
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        required
      />
      <Button type="submit" size="lg" disabled={busy || !password} className="w-full">
        {busy ? "바꾸는 중…" : "비밀번호 바꾸기"}
      </Button>
      <p className="m-0 text-[13px] leading-[1.6] text-ink-2">바꾸면 다른 기기의 로그인은 모두 끝납니다.</p>
    </form>
  );
}
