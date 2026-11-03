"use client";

import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useState } from "react";
import { Button, Field, Notice } from "@aionit/ui";
import { api } from "@/lib/client-api";

const ROLE_LABEL = { operator: "운영자", instructor: "강사" } as const;

export function RoleForm({ userId, roles, self }: { userId: string; roles: string[]; self: boolean }) {
  const router = useRouter();
  const [role, setRole] = useState<"operator" | "instructor">("instructor");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const has = roles.includes(role);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await api(`/admin/users/${userId}/roles`, { role, grant: !has, reason });
    setBusy(false);
    if (!result.ok) return setError(result.error.message);
    setReason("");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 border-t border-line-strong pt-5">
      <h2 className="m-0 text-[19px] font-semibold">역할</h2>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        역할
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as "operator" | "instructor")}
          className="min-h-11 rounded-ui border border-line bg-surface px-3 text-[15px] font-normal"
        >
          <option value="instructor">강사</option>
          <option value="operator">운영자</option>
        </select>
      </label>
      <Field
        label="사유 (기록에 남습니다)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        required
      />
      <p className="m-0 text-[13px] text-ink-2">
        바꾸면 그 회원은 다시 로그인해야 합니다. 운영자 · 강사는 2단계 인증을 켜야 관리 화면에 들어갈 수
        있습니다.
      </p>
      <Button
        type="submit"
        variant={has ? "danger" : "outline"}
        disabled={busy || reason.trim().length < 2 || (has && self && role === "operator")}
        className="self-start"
      >
        {has ? `${ROLE_LABEL[role]} 역할 거두기` : `${ROLE_LABEL[role]} 역할 주기`}
      </Button>
    </form>
  );
}

export function StatusForm({ userId, status, self }: { userId: string; status: string; self: boolean }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const suspended = status === "suspended";

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await api(`/admin/users/${userId}/status`, {
      status: suspended ? "active" : "suspended",
      reason,
    });
    setBusy(false);
    if (!result.ok) return setError(result.error.message);
    setReason("");
    router.refresh();
  }

  if (self) return null;
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 border-t border-line-strong pt-5">
      <h2 className="m-0 text-[19px] font-semibold">이용 정지</h2>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Field
        label="사유 (기록에 남습니다)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        required
      />
      <p className="m-0 text-[13px] text-ink-2">
        정지하면 그 회원의 로그인이 모두 끝나고, 다시 로그인할 수 없습니다.
      </p>
      <Button
        type="submit"
        variant={suspended ? "outline" : "danger"}
        disabled={busy || reason.trim().length < 2}
        className="self-start"
      >
        {suspended ? "정지 풀기" : "이용 정지"}
      </Button>
    </form>
  );
}
