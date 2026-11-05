"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Field, Notice } from "@aionit/ui";
import { api } from "@/lib/client-api";

export function ReviewActions({
  versionId,
  status,
  courseId,
}: {
  versionId: string;
  status: string;
  courseId: string;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: "publish" | "reject" | "rollback", body: unknown, confirmText: string) {
    if (!window.confirm(confirmText)) return;
    setBusy(true);
    setError(null);
    const result = await api(`/admin/versions/${versionId}/${action}`, body);
    setBusy(false);
    if (!result.ok) return setError(result.error.message);
    router.push(`/admin/courses/${courseId}`);
    router.refresh();
  }

  const reviewable = status === "ready" || status === "in_review";

  return (
    <div className="flex flex-col gap-6">
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {reviewable ? (
        <div className="flex max-w-[560px] flex-col gap-4">
          <Field
            label="공개 메모 (선택, 기록에 남습니다)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <Button
            disabled={busy}
            onClick={() =>
              run(
                "publish",
                { note: note || undefined },
                "이 버전을 공개할까요? 지금 공개 중인 버전은 지난 공개본이 됩니다.",
              )
            }
            className="self-start"
          >
            승인하고 공개
          </Button>
        </div>
      ) : null}
      {reviewable || status === "invalid" ? (
        <div className="flex max-w-[560px] flex-col gap-4 border-t border-line pt-5">
          <Field
            label="반려 사유 (필수)"
            hint="강사가 올린 버전이면 사유가 강사 화면과 메일로 갑니다."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <Button
            variant="danger"
            disabled={busy || reason.trim().length < 2}
            onClick={() => run("reject", { reason }, "이 버전을 반려할까요?")}
            className="self-start"
          >
            반려
          </Button>
        </div>
      ) : null}
      {status === "archived" ? (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            run("rollback", {}, "이 버전으로 되돌릴까요? 지금 공개 중인 버전은 지난 공개본이 됩니다.")
          }
          className="self-start"
        >
          이 버전으로 되돌리기
        </Button>
      ) : null}
      {status === "published" ? <p className="m-0 text-ink-2">지금 공개 중인 버전입니다.</p> : null}
    </div>
  );
}
