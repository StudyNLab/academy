"use client";

import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useState } from "react";
import { Button, Checkbox, Field, Notice } from "@aionit/ui";
import { TextArea } from "@/components/text-area";
import { api, apiDelete } from "@/lib/client-api";

const MD_HINT =
  "빈 줄로 문단을 나눕니다. **굵게**, '- ' 목록, '1. ' 번호 목록, '> ' 안내, '| ' 표를 쓸 수 있습니다.";

/** AD-12 공지 쓰기 · 고치기 · 지우기. 게시하지 않고 저장하면 운영자만 미리 본다 */
export function NoticeForm({
  notice,
}: {
  notice?: { id: string; title: string; bodyMd: string; pinned: boolean; published: boolean };
}) {
  const router = useRouter();
  const [title, setTitle] = useState(notice?.title ?? "");
  const [bodyMd, setBodyMd] = useState(notice?.bodyMd ?? "");
  const [pinned, setPinned] = useState(notice?.pinned ?? false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "done" | "danger"; text: string } | null>(null);

  async function save(publish: boolean) {
    setBusy(true);
    const result = await api<{ id: string }>(notice ? `/admin/notices/${notice.id}` : "/admin/notices", {
      title,
      bodyMd,
      pinned,
      publish,
    });
    setBusy(false);
    if (!result.ok) return setMessage({ tone: "danger", text: result.error.message });
    if (!notice) return router.push(`/admin/notices/${result.data.id}`);
    setMessage({ tone: "done", text: publish ? "게시했습니다." : "게시하지 않고 저장했습니다." });
    router.refresh();
  }

  async function remove() {
    if (!notice || !window.confirm("이 공지를 지울까요?")) return;
    const result = await apiDelete(`/admin/notices/${notice.id}`);
    if (!result.ok) return setMessage({ tone: "danger", text: result.error.message });
    router.push("/admin/notices");
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void save(true);
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-[760px] flex-col gap-4">
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <Field label="제목" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required />
      <TextArea
        label="내용"
        value={bodyMd}
        onChange={setBodyMd}
        rows={12}
        maxLength={20_000}
        hint={MD_HINT}
      />
      <Checkbox checked={pinned} onChange={(e) => setPinned(e.target.checked)}>
        목록 맨 위에 고정
      </Checkbox>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={busy}>
          {notice?.published ? "고쳐서 게시" : "게시하기"}
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => void save(false)}>
          {notice?.published ? "게시 내리기" : "게시하지 않고 저장"}
        </Button>
        {notice ? (
          <Button variant="outline" disabled={busy} onClick={() => void remove()}>
            지우기
          </Button>
        ) : null}
      </div>
    </form>
  );
}

/** AD-12 자주 묻는 질문 하나 (더하기 · 고치기 · 지우기) */
export function FaqForm({
  faq,
}: {
  faq?: {
    id: string;
    category: string;
    question: string;
    answerMd: string;
    sortOrder: number;
    published: boolean;
  };
}) {
  const router = useRouter();
  const [category, setCategory] = useState(faq?.category ?? "");
  const [question, setQuestion] = useState(faq?.question ?? "");
  const [answerMd, setAnswerMd] = useState(faq?.answerMd ?? "");
  const [sortOrder, setSortOrder] = useState(String(faq?.sortOrder ?? 0));
  const [published, setPublished] = useState(faq?.published ?? true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "done" | "danger"; text: string } | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const result = await api(faq ? `/admin/faqs/${faq.id}` : "/admin/faqs", {
      category,
      question,
      answerMd,
      sortOrder: Number(sortOrder) || 0,
      published,
    });
    setBusy(false);
    if (!result.ok) return setMessage({ tone: "danger", text: result.error.message });
    setMessage({ tone: "done", text: "저장했습니다." });
    if (!faq) {
      setQuestion("");
      setAnswerMd("");
    }
    router.refresh();
  }

  async function remove() {
    if (!faq || !window.confirm("이 질문을 지울까요?")) return;
    const result = await apiDelete(`/admin/faqs/${faq.id}`);
    if (!result.ok) return setMessage({ tone: "danger", text: result.error.message });
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <div className="grid gap-4 md:grid-cols-[1fr_120px]">
        <Field
          label="분류"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          maxLength={40}
          required
          hint="예: 결제 · 환불, 수강, 계정"
        />
        <Field
          label="순서"
          type="number"
          min={0}
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value)}
        />
      </div>
      <Field
        label="질문"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        maxLength={200}
        required
      />
      <TextArea
        label="답"
        value={answerMd}
        onChange={setAnswerMd}
        rows={6}
        maxLength={10_000}
        hint={MD_HINT}
      />
      <Checkbox checked={published} onChange={(e) => setPublished(e.target.checked)}>
        사이트에 보이기
      </Checkbox>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" variant={faq ? "outline" : "primary"} disabled={busy}>
          {faq ? "저장" : "더하기"}
        </Button>
        {faq ? (
          <Button variant="outline" disabled={busy} onClick={() => void remove()}>
            지우기
          </Button>
        ) : null}
      </div>
    </form>
  );
}
