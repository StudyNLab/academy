"use client";

import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useId, useState } from "react";
import { TextArea } from "@/components/text-area";
import { QNA_LIMITS } from "@aionit/core";
import { Button, Field, inputClass, Notice } from "@aionit/ui";
import { api } from "@/lib/client-api";

export function InquiryForm({
  categories,
  initialCategory,
}: {
  categories: string[];
  initialCategory: string;
}) {
  const router = useRouter();
  const [category, setCategory] = useState(initialCategory);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const categoryId = useId();

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const result = await api<{ id: string }>("/inquiries", { category, title, body });
    setBusy(false);
    if (!result.ok) return setError(result.error.message);
    router.push(`/my/inquiries/${result.data.id}`);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <div className="flex flex-col gap-1.5">
        <label htmlFor={categoryId} className="text-sm font-semibold text-ink">
          문의 종류
        </label>
        <select
          id={categoryId}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className={inputClass}
          required
        >
          <option value="">고르세요</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <Field label="제목" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required />
      <TextArea label="내용" value={body} onChange={setBody} maxLength={QNA_LIMITS.inquiryBodyMax} />
      <Button type="submit" disabled={busy || !category} className="self-start">
        문의 보내기
      </Button>
    </form>
  );
}

/** 문의에 이어서 쓰기 · 해결됐어요(닫기) */
export function InquiryReply({ id, canClose }: { id: string; canClose: boolean }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(payload: Record<string, unknown>) {
    setBusy(true);
    const result = await api(`/inquiries/${id}`, payload);
    setBusy(false);
    if (!result.ok) return setError(result.error.message);
    setBody("");
    setError(null);
    router.refresh();
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void send({ action: "message", body });
      }}
      className="flex flex-col gap-4 border-t border-line-strong pt-6"
    >
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <TextArea
        label="이어서 쓰기"
        value={body}
        onChange={setBody}
        rows={5}
        maxLength={QNA_LIMITS.inquiryBodyMax}
      />
      <div className="flex flex-wrap gap-3">
        <Button type="submit" variant="outline" disabled={busy || body.trim().length < 2}>
          보내기
        </Button>
        {canClose ? (
          <Button variant="outline" disabled={busy} onClick={() => void send({ action: "close" })}>
            해결됐어요 (문의 닫기)
          </Button>
        ) : null}
      </div>
    </form>
  );
}
