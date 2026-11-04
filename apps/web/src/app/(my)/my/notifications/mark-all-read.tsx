"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@aionit/ui";
import { api } from "@/lib/client-api";

export function MarkAllRead({ count }: { count: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <div className="mb-4 flex items-center justify-between gap-4 text-[14px]">
      <span className="text-ink-2">읽지 않은 알림 {count}개</span>
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await api("/notifications");
          setBusy(false);
          router.refresh();
        }}
      >
        모두 읽음
      </Button>
    </div>
  );
}
