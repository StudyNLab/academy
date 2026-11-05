"use client";

// AD-12 정책 문서: 새 버전 (시행일 · 불리한 변경) · 시행 전 버전 지우기
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useState } from "react";
import { Button, Checkbox, Field, Notice } from "@aionit/ui";
import { TextArea } from "@/components/text-area";
import { api, apiDelete } from "@/lib/client-api";

const MD_HINT =
  "빈 줄로 문단을 나눕니다. '## ' 제목, **굵게**, '- ' 목록, '1. ' 번호 목록, '> ' 안내, '| ' 표를 쓸 수 있습니다.";

export function PolicyVersionForm({
  kind,
  title,
  bodyMd,
  earliest,
  earliestAdverse,
}: {
  kind: string;
  title: string;
  bodyMd: string;
  /** 알릴 기간을 지킨 가장 이른 시행일 (보통 · 불리한 변경) */
  earliest: string;
  earliestAdverse: string;
}) {
  const router = useRouter();
  const [version, setVersion] = useState("");
  const [docTitle, setDocTitle] = useState(title);
  const [body, setBody] = useState(bodyMd);
  const [adverse, setAdverse] = useState(false);
  const [effectiveOn, setEffectiveOn] = useState(earliest);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "done" | "danger"; text: string } | null>(null);
  const min = adverse ? earliestAdverse : earliest;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!window.confirm(`${effectiveOn} 부터 시행하는 새 버전을 게시할까요? 게시한 내용은 고칠 수 없습니다.`))
      return;
    setBusy(true);
    const result = await api("/admin/policies", {
      kind,
      version,
      title: docTitle,
      bodyMd: body,
      effectiveOn,
      adverse,
    });
    setBusy(false);
    if (!result.ok) return setMessage({ tone: "danger", text: result.error.message });
    setMessage({ tone: "done", text: "게시했습니다. 시행일 전까지 정책 화면에 '시행 예정' 으로 보입니다." });
    setVersion("");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-[760px] flex-col gap-4">
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <Field
        label="버전 이름"
        value={version}
        onChange={(e) => setVersion(e.target.value)}
        placeholder="예: 2026-12-01"
        maxLength={40}
        required
      />
      <Field
        label="제목"
        value={docTitle}
        onChange={(e) => setDocTitle(e.target.value)}
        maxLength={100}
        required
      />
      <TextArea label="내용" value={body} onChange={setBody} rows={18} maxLength={100_000} hint={MD_HINT} />
      <Checkbox
        checked={adverse}
        onChange={(e) => {
          setAdverse(e.target.checked);
          if (e.target.checked && effectiveOn < earliestAdverse) setEffectiveOn(earliestAdverse);
        }}
      >
        회원(강사)에게 불리한 변경 — 30일 전에 알립니다
      </Checkbox>
      <Field
        label="시행일 (이날 0시, 한국 시각)"
        type="date"
        value={effectiveOn}
        min={min}
        onChange={(e) => setEffectiveOn(e.target.value)}
        hint={`가장 이른 날: ${min}. 시행일 전에는 지금 버전이 그대로 쓰이고, 정책 화면에 시행 예정 버전이 함께 보입니다.`}
        required
      />
      <div>
        <Button type="submit" disabled={busy}>
          새 버전 게시
        </Button>
      </div>
    </form>
  );
}

export function DeletePolicyButton({ id, version }: { id: string; version: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (!window.confirm(`시행 예정 버전 ${version} 을 지울까요?`)) return;
    setBusy(true);
    const result = await apiDelete(`/admin/policies/${id}`);
    setBusy(false);
    if (!result.ok) return setError(result.error.message);
    router.refresh();
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button variant="outline" disabled={busy} onClick={() => void remove()}>
        지우기
      </Button>
      {error ? <span className="text-[13px] text-danger">{error}</span> : null}
    </span>
  );
}
