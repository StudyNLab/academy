import { getAuth } from "@/server/auth-instance";
import { getDb } from "@/server/db";
import { getEnv } from "@/server/env";
import { openNotification } from "@/server/notifications";
import { SupportError } from "@/server/support-error";
import { loadViewer } from "@/server/viewer";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 알림 열기: 읽음으로 하고 그 화면으로 보낸다 (알림 주소는 사이트 안 경로만 저장한다)
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const base = getEnv().BETTER_AUTH_URL;
  const { id } = await params;
  const viewer = await loadViewer(getAuth(), getDb(), request.headers);
  if (!viewer)
    return Response.redirect(new URL(`/login?next=${encodeURIComponent("/my/notifications")}`, base), 303);
  let url = "/my/notifications";
  try {
    if (UUID.test(id)) url = await openNotification(getDb(), viewer.userId, id);
  } catch (error) {
    if (!(error instanceof SupportError)) throw error;
  }
  return Response.redirect(new URL(url, base), 303);
}
