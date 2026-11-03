"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { Button, Field, Notice } from "@aionit/ui";
import { api } from "@/lib/client-api";

const CONFIRM = "탈퇴합니다";

export function WithdrawForm({ needsPassword }: { needsPassword: boolean }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const result = await api("/me/withdraw", { confirm, ...(needsPassword ? { password } : {}) });
    setBusy(false);
    if (!result.ok) return setError(result.error.message);
    window.location.assign("/login?withdrawn=1");
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {needsPassword ? (
        <Field
          label="비밀번호"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      ) : (
        <p className="m-0 text-[14px] text-ink-2">
          본인 확인을 위해 로그인한 지 15분 안에만 탈퇴할 수 있습니다.
        </p>
      )}
      <Field
        label={`확인을 위해 '${CONFIRM}' 를 입력하세요`}
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        autoComplete="off"
        required
      />
      <Button type="submit" variant="danger" disabled={busy || confirm !== CONFIRM} className="self-start">
        회원 탈퇴
      </Button>
    </form>
  );
}
