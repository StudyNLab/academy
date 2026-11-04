"use client";

// AD-05 자체 서버 영상: 올리기(16MB 조각, 3개씩 동시에, 끊기면 이어 올리기) · 자막 · 다시 변환 · 지우기 · 영상 자리 연결
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useState } from "react";
import { Button, Field, inputClass, Notice, ProgressBar } from "@aionit/ui";
import { HostedVideo } from "@/components/learn/hosted-video";
import { api, apiDelete } from "@/lib/client-api";
import type { Playback } from "@/server/videos";

const PARALLEL = 3;
const RETRIES = 4;

async function putPart(assetId: string, n: number, body: Blob): Promise<string | null> {
  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    try {
      const response = await fetch(`/api/v1/admin/videos/${assetId}/parts/${n}`, {
        method: "PUT",
        body,
        credentials: "same-origin",
      });
      if (response.ok) return null;
      const data = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
      // 서버가 거절한 것(잘못된 파일 등)은 다시 보내도 같다
      if (response.status < 500 && response.status !== 429)
        return data?.error?.message ?? "조각을 올리지 못했습니다.";
    } catch {
      // 연결이 끊겼다: 잠시 뒤 다시
    }
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
  return "연결이 끊겨 올리지 못했습니다. 같은 파일을 다시 골라 이어 올려 주세요.";
}

/** 빠진 조각만 올리고 마무리한다 (처음 올리기 · 이어 올리기 같은 흐름) */
async function sendParts(
  assetId: string,
  file: File,
  partBytes: number,
  done: Set<number>,
  onProgress: (ratio: number) => void,
): Promise<string | null> {
  const total = Math.ceil(file.size / partBytes);
  const todo = Array.from({ length: total }, (_, i) => i + 1).filter((n) => !done.has(n));
  let finished = total - todo.length;
  onProgress(finished / total);
  let failure: string | null = null;
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(PARALLEL, todo.length) }, async () => {
      while (!failure && next < todo.length) {
        const n = todo[next++]!;
        const error = await putPart(assetId, n, file.slice((n - 1) * partBytes, n * partBytes));
        if (error) failure = error;
        else onProgress(++finished / total);
      }
    }),
  );
  if (failure) return failure;
  const result = await api(`/admin/videos/${assetId}/complete`);
  return result.ok ? null : result.error.message;
}

async function sendSubtitle(assetId: string, srt: File): Promise<string | null> {
  const form = new FormData();
  form.set("file", srt);
  const result = await api(`/admin/videos/${assetId}/subtitles`, form);
  return result.ok ? null : result.error.message;
}

export function VideoUploadForm({ courseId }: { courseId: string }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [srt, setSrt] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setError(null);
    setProgress(0);
    const started = await api<{ id: string; partBytes: number }>(`/admin/courses/${courseId}/videos`, {
      title,
      fileName: file.name,
      size: file.size,
    });
    if (!started.ok) {
      setProgress(null);
      return setError(started.error.message);
    }
    const failed =
      (await sendParts(started.data.id, file, started.data.partBytes, new Set(), setProgress)) ??
      (srt ? await sendSubtitle(started.data.id, srt) : null);
    setProgress(null);
    if (failed) setError(failed);
    else {
      setTitle("");
      setFile(null);
      setSrt(null);
    }
    router.refresh();
  }

  const busy = progress !== null;
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <h3 className="m-0 text-[17px] font-semibold">영상 올리기</h3>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Field
        label="영상 제목"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        required
        maxLength={100}
      />
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        영상 파일 (mp4 · mov · mkv · webm, 8GB 까지)
        <input
          type="file"
          accept="video/mp4,video/quicktime,video/x-matroska,video/webm,.mp4,.mov,.m4v,.mkv,.webm"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-[14px] font-normal"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        자막 (srt, 없어도 됨)
        <input
          type="file"
          accept=".srt"
          onChange={(e) => setSrt(e.target.files?.[0] ?? null)}
          className="text-[14px] font-normal"
        />
      </label>
      {busy ? (
        <div className="flex flex-col gap-1">
          <ProgressBar value={Math.round(progress * 100)} label="올리기 진행" />
          <span className="text-[13px] tabular-nums text-ink-2">
            올리는 중 {Math.round(progress * 100)}% · 이 화면을 닫지 마세요
          </span>
        </div>
      ) : null}
      <p className="m-0 text-[13px] text-ink-2">
        다 올리면 서버가 360p · 720p · 1080p 암호화 HLS 로 바꿉니다 (1시간 영상은 수십 분). 바꾸는 동안 이
        화면을 닫아도 됩니다.
      </p>
      <Button type="submit" disabled={busy || !file || title.trim().length < 2} className="self-start">
        {busy ? "올리는 중…" : "영상 올리기"}
      </Button>
    </form>
  );
}

/** 올리다 끊긴 영상: 같은 파일을 다시 고르면 빠진 조각만 올린다 */
export function ResumeUpload({
  assetId,
  size,
  fileName,
  partBytes,
}: {
  assetId: string;
  size: number;
  fileName: string;
  partBytes: number;
}) {
  const router = useRouter();
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function resume(file: File) {
    if (file.size !== size) return setError(`처음 고른 파일(${fileName})과 크기가 다릅니다.`);
    setError(null);
    setProgress(0);
    const status = await fetch(`/api/v1/admin/videos/${assetId}`, { credentials: "same-origin" })
      .then((r) => r.json() as Promise<{ parts?: number[] }>)
      .catch(() => null);
    const failed = await sendParts(assetId, file, partBytes, new Set(status?.parts ?? []), setProgress);
    setProgress(null);
    if (failed) setError(failed);
    router.refresh();
  }

  return (
    <span className="flex flex-col gap-1">
      <label className="text-[13px]">
        이어 올리기:{" "}
        <input
          type="file"
          disabled={progress !== null}
          onChange={(e) => e.target.files?.[0] && void resume(e.target.files[0])}
          className="text-[13px]"
        />
      </label>
      {progress !== null ? (
        <span className="text-[13px] tabular-nums text-ink-2">올리는 중 {Math.round(progress * 100)}%</span>
      ) : null}
      {error ? (
        <span role="alert" className="text-[13px] text-danger">
          ! {error}
        </span>
      ) : null}
    </span>
  );
}

export function VideoActions({
  assetId,
  canRetranscode,
  canRemove,
}: {
  assetId: string;
  canRetranscode: boolean;
  canRemove: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(work: () => Promise<{ ok: boolean; error?: { message: string } }>) {
    setBusy(true);
    setError(null);
    const result = await work();
    setBusy(false);
    if (!result.ok) setError(result.error?.message ?? "실패했습니다.");
    router.refresh();
  }

  return (
    <span className="flex flex-wrap items-center gap-3">
      <label className="text-[13px]">
        자막 srt{" "}
        <input
          type="file"
          accept=".srt"
          disabled={busy}
          onChange={(e) => {
            const srt = e.target.files?.[0];
            if (srt)
              void run(async () => {
                const failed = await sendSubtitle(assetId, srt);
                return failed ? { ok: false, error: { message: failed } } : { ok: true };
              });
          }}
          className="w-[180px] text-[13px]"
        />
      </label>
      {canRetranscode ? (
        <Button
          variant="outline"
          size="md"
          disabled={busy}
          onClick={() => void run(() => api(`/admin/videos/${assetId}/retranscode`))}
        >
          다시 변환
        </Button>
      ) : null}
      {canRemove ? (
        <Button
          variant="outline"
          size="md"
          disabled={busy}
          onClick={() => {
            if (window.confirm("이 영상을 지울까요? 원본과 변환한 파일이 모두 지워집니다."))
              void run(() => apiDelete(`/admin/videos/${assetId}`));
          }}
        >
          지우기
        </Button>
      ) : null}
      {error ? (
        <span role="alert" className="text-[13px] text-danger">
          ! {error}
        </span>
      ) : null}
    </span>
  );
}

/** 운영자 화면에서 변환 결과 보기 (수강생 화면과 같은 플레이어 · 워터마크) */
export function AdminVideoPlayer({ assetId, title }: { assetId: string; title: string }) {
  return (
    <div className="aspect-video w-full">
      <HostedVideo title={title} load={() => api<Playback>(`/admin/videos/${assetId}/playback`)} />
    </div>
  );
}

/** 영상 자리에 자체 서버 영상 연결 (같은 과정의, 변환이 끝난 영상) */
export function HostedSlotForm({
  slotId,
  slotKey,
  current,
  assets,
}: {
  slotId: string;
  slotKey: string;
  current: string | null;
  assets: { id: string; title: string }[];
}) {
  const router = useRouter();
  const [picked, setPicked] = useState(current ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(assetId: string | null) {
    setBusy(true);
    setError(null);
    const result = await api(`/admin/video-slots/${slotId}`, { assetId });
    setBusy(false);
    if (!result.ok) return setError(result.error.message);
    if (!assetId) setPicked("");
    router.refresh();
  }

  if (assets.length === 0 && !current) return null;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-2">
        <label className="sr-only" htmlFor={`hosted-${slotKey}`}>
          자체 서버 영상
        </label>
        <select
          id={`hosted-${slotKey}`}
          value={picked}
          onChange={(e) => setPicked(e.target.value)}
          className={`${inputClass} min-w-[240px] flex-1`}
        >
          <option value="">자체 서버 영상 고르기 (수강생 전용)</option>
          {assets.map((a) => (
            <option key={a.id} value={a.id}>
              {a.title}
            </option>
          ))}
        </select>
        <Button
          variant="outline"
          size="md"
          disabled={busy || !picked || picked === current}
          onClick={() => void save(picked)}
        >
          {current ? "바꾸기" : "연결"}
        </Button>
        {current ? (
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
    </div>
  );
}
