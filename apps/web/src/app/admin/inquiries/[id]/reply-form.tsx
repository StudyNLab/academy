"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Notice } from "@aionit/ui";
import { api } from "@/lib/client-api";
import { TextArea } from "@/components/text-area";

/** AD-13 답변 쓰기 (회원에게 알림 · 메일) · 답변하고 닫기 · 그냥 닫기 */
export function AdminInquiryReply({ id }: { id: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(payload: Record<string, unknown>) {
    setBusy(true);
    const result = await api(`/admin/inquiries/${id}`, payload);
    setBusy(false);
    if (!result.ok) return setError(result.error.message);
    setBody("");
    setError(null);
    router.refresh();
  }

  const ready = body.trim().length >= 2;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void send({ action: "reply", body });
      }}
      className="flex flex-col gap-4 border-t border-line-strong pt-6"
    >
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <TextArea label="답변" value={body} onChange={setBody} />
      <p className="m-0 text-[13px] text-ink-2">
        답변하면 회원에게 사이트 알림과 메일이 갑니다 (메일에는 답변 내용을 넣지 않습니다).
      </p>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={busy || !ready}>
          답변 보내기
        </Button>
        <Button
          variant="outline"
          disabled={busy || !ready}
          onClick={() => void send({ action: "reply", body, close: true })}
        >
          답변하고 닫기
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => {
            if (window.confirm("답변 없이 문의를 닫을까요?")) void send({ action: "close" });
          }}
        >
          닫기
        </Button>
      </div>
    </form>
  );
}
