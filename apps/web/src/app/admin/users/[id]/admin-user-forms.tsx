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
    <form onSubmit={onSubmit} className="flex flex-col gap-4 surface padded">
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
    <form onSubmit={onSubmit} className="flex flex-col gap-4 surface padded">
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

// ---- 수강권 (AD-08) ----

const PERIODS = [
  { value: "90", label: "90일" },
  { value: "180", label: "180일" },
  { value: "365", label: "1년" },
  { value: "30", label: "30일" },
  { value: "", label: "무제한" },
];

export function GrantEntitlementForm({
  userId,
  courses,
}: {
  userId: string;
  courses: { id: string; title: string }[];
}) {
  const router = useRouter();
  const [courseId, setCourseId] = useState(courses[0]?.id ?? "");
  const [days, setDays] = useState("90");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await api(`/admin/users/${userId}/entitlements`, {
      courseId,
      days: days ? Number(days) : null,
      reason,
    });
    setBusy(false);
    if (!result.ok) return setError(result.error.message);
    setReason("");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 surface padded">
      <h3 className="m-0 text-[17px] font-semibold">수강권 발급</h3>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <div className="grid gap-4 sm:grid-cols-[1fr_160px]">
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          과정
          <select
            value={courseId}
            onChange={(e) => setCourseId(e.target.value)}
            className="min-h-11 rounded-ui border border-line bg-surface px-3 text-[15px] font-normal"
          >
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          기간 (오늘부터)
          <select
            value={days}
            onChange={(e) => setDays(e.target.value)}
            className="min-h-11 rounded-ui border border-line bg-surface px-3 text-[15px] font-normal"
          >
            {PERIODS.map((p) => (
              <option key={p.label} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Field
        label="사유 (기록에 남습니다)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="예: 베타 수강생"
        required
      />
      <Button
        type="submit"
        variant="outline"
        disabled={busy || !courseId || reason.trim().length < 2}
        className="self-start"
      >
        수강권 발급
      </Button>
    </form>
  );
}

export function EntitlementActions({ id, endsOn }: { id: string; endsOn: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(endsOn ?? "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const result = await api(`/admin/entitlements/${id}`, { ...body, reason });
    setBusy(false);
    if (!result.ok) return setError(result.error.message);
    setOpen(false);
    setReason("");
    router.refresh();
  }

  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-[14px] text-link underline">
        바꾸기
      </button>
    );
  return (
    <div className="mt-3 flex flex-col gap-3">
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        끝나는 날 (비우면 무제한)
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="min-h-11 rounded-ui border border-line bg-surface px-3 text-[15px] font-normal"
        />
      </label>
      <Field
        label="사유 (기록에 남습니다)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        required
      />
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy || reason.trim().length < 2}
          onClick={() => void send({ action: "adjust", endsOn: date || null })}
        >
          기간 저장
        </Button>
        <Button
          type="button"
          variant="danger"
          size="sm"
          disabled={busy || reason.trim().length < 2}
          onClick={() => void send({ action: "revoke" })}
        >
          회수
        </Button>
        <button type="button" onClick={() => setOpen(false)} className="text-[14px] text-ink-2 underline">
          닫기
        </button>
      </div>
    </div>
  );
}
