"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { Button, Checkbox, Field, inputClass, Notice } from "@aionit/ui";
import { api, apiDelete } from "@/lib/client-api";

/** 교재 · 영상이 처리되는 동안 3초마다 화면을 새로 그린다 */
export function AutoRefresh({
  message = "교재를 검사하고 있습니다. 끝나면 이 화면이 저절로 바뀝니다.",
}: {
  message?: string;
}) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [router]);
  return (
    <p role="status" className="mt-0 text-[14px] text-ink-2">
      {message}
    </p>
  );
}

export function UploadPackageForm({ courseId, slug }: { courseId: string; slug: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set("package", file);
    const result = await api<{ id: string }>(`/admin/courses/${courseId}/versions`, form);
    setBusy(false);
    if (!result.ok) return setError(result.error.message);
    router.push(`/admin/courses/${courseId}/versions/${result.data.id}`);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <h3 className="m-0 text-[17px] font-semibold">교재 패키지 올리기</h3>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        zip 파일 (course_id = {slug}, 200MB 까지)
        <input
          type="file"
          accept=".zip,application/zip"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-[14px] font-normal"
        />
      </label>
      <p className="m-0 text-[13px] text-ink-2">
        같은 버전을 다시 올리면 덮어씁니다 (공개 전까지). 올리면 구조 · 허용 목록 · 그림 검사를 하고 검수
        대기로 바뀝니다.
      </p>
      <Button type="submit" disabled={busy || !file} className="self-start">
        {busy ? "올리는 중…" : "올리기"}
      </Button>
    </form>
  );
}

export function VideoSlotForm({
  slotId,
  label,
  videoKey,
  youtubeVideoId,
}: {
  slotId: string;
  label: string;
  videoKey: string;
  youtubeVideoId: string | null;
}) {
  const router = useRouter();
  const [url, setUrl] = useState(youtubeVideoId ? `https://youtu.be/${youtubeVideoId}` : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(next: string | null) {
    setBusy(true);
    setError(null);
    const result = await api(`/admin/video-slots/${slotId}`, { url: next });
    setBusy(false);
    if (!result.ok) return setError(result.error.message);
    if (next === null) setUrl("");
    router.refresh();
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save(url || null);
      }}
      className="flex flex-col gap-2"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[15px]">{label}</span>
        <code className="font-mono text-[12px] text-ink-2">{videoKey}</code>
      </div>
      <div className="flex flex-wrap gap-2">
        <label className="sr-only" htmlFor={`yt-${slotId}`}>
          유튜브 주소
        </label>
        <input
          id={`yt-${slotId}`}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://youtu.be/..."
          className={`${inputClass} min-w-[240px] flex-1`}
        />
        <Button type="submit" variant="outline" size="md" disabled={busy}>
          {youtubeVideoId ? "바꾸기" : "연결"}
        </Button>
        {youtubeVideoId ? (
          <Button variant="outline" size="md" disabled={busy} onClick={() => void save(null)}>
            끊기
          </Button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="m-0 text-[13px] text-danger">
          ! {error}
        </p>
      ) : null}
    </form>
  );
}

export function PreviewRuleForm({
  courseId,
  chapterKey,
  title,
  sections,
  initialScope,
  initialSections,
  previewHref,
}: {
  courseId: string;
  chapterKey: string;
  title: string;
  sections: { id: string; title: string }[];
  initialScope: "whole" | "sections" | "none";
  initialSections: string[];
  previewHref: string;
}) {
  const router = useRouter();
  const [scope, setScope] = useState(initialScope);
  const [picked, setPicked] = useState<string[]>(initialSections);
  const [message, setMessage] = useState<{ tone: "done" | "danger"; text: string } | null>(null);

  async function save() {
    const result = await api(`/admin/courses/${courseId}/previews`, {
      chapterKey,
      scope,
      sectionIds: picked,
    });
    setMessage(
      result.ok ? { tone: "done", text: "저장했습니다." } : { tone: "danger", text: result.error.message },
    );
    if (result.ok) router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-[15px]">
          <span className="font-mono text-[12px] text-ink-2">{chapterKey}</span> {title}
        </span>
        <span className="flex items-center gap-3">
          <label className="sr-only" htmlFor={`scope-${chapterKey}`}>
            미리보기 범위
          </label>
          <select
            id={`scope-${chapterKey}`}
            value={scope}
            onChange={(e) => setScope(e.target.value as typeof scope)}
            className={`${inputClass} w-auto`}
          >
            <option value="none">미리보기 없음</option>
            <option value="whole">챕터 전체</option>
            <option value="sections">일부 Section</option>
          </select>
          <Button variant="outline" size="md" onClick={() => void save()}>
            저장
          </Button>
          {initialScope !== "none" ? <Link href={previewHref}>보기 →</Link> : null}
        </span>
      </div>
      {scope === "sections" ? (
        <div className="grid gap-x-6 pl-2 sm:grid-cols-2">
          {sections.map((s) => (
            <Checkbox
              key={s.id}
              checked={picked.includes(s.id)}
              onChange={(e) =>
                setPicked((p) => (e.target.checked ? [...p, s.id] : p.filter((x) => x !== s.id)))
              }
            >
              {s.title}
            </Checkbox>
          ))}
        </div>
      ) : null}
      {message ? (
        <p
          role="status"
          className={`m-0 text-[13px] ${message.tone === "danger" ? "text-danger" : "text-ink-2"}`}
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}

export function AttachmentForm({
  courseId,
  chapters,
}: {
  courseId: string;
  chapters: { key: string; title: string }[];
}) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [chapterKey, setChapterKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set("file", file);
    form.set("title", title);
    form.set("chapterKey", chapterKey);
    const result = await api(`/admin/courses/${courseId}/attachments`, form);
    setBusy(false);
    if (!result.ok) return setError(result.error.message);
    setTitle("");
    setFile(null);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        챕터
        <select
          value={chapterKey}
          onChange={(e) => setChapterKey(e.target.value)}
          className={`${inputClass} font-normal`}
        >
          <option value="">과정 전체</option>
          {chapters.map((c) => (
            <option key={c.key} value={c.key}>
              {c.key} · {c.title}
            </option>
          ))}
        </select>
      </label>
      <Field
        label="제목"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        hint="예: 실습 1 시작 파일"
      />
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        zip 파일 (100MB 까지)
        <input
          type="file"
          accept=".zip,application/zip"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-[14px] font-normal"
        />
      </label>
      <Button
        type="submit"
        variant="outline"
        disabled={busy || !file || title.trim().length < 2}
        className="self-start"
      >
        첨부 자료 올리기
      </Button>
    </form>
  );
}

export function AttachmentRemove({ attachmentId }: { attachmentId: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className="min-h-11 border-0 bg-transparent p-0 text-[14px] text-danger underline"
      onClick={async () => {
        if (!window.confirm("이 첨부 자료를 지울까요?")) return;
        const result = await apiDelete(`/admin/attachments/${attachmentId}`);
        if (result.ok) router.refresh();
        else window.alert(result.error.message);
      }}
    >
      지우기
    </button>
  );
}

export function VisibilityToggle({ courseId, hidden }: { courseId: string; hidden: boolean }) {
  const router = useRouter();
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={async () => {
        const result = await api(`/admin/courses/${courseId}/visibility`, { hidden: !hidden });
        if (result.ok) router.refresh();
        else window.alert(result.error.message);
      }}
    >
      {hidden ? "목록에 다시 보이기" : "목록에서 숨기기"}
    </Button>
  );
}
