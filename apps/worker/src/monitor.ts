// 감시(Gatus)에 "worker 가 살아 있다" 를 보낸다 (M10, infra/monitor/config.yaml 의 external-endpoint app_worker).
// MONITOR_WORKER_PUSH_URL · MONITOR_WORKER_PUSH_TOKEN 이 없으면 아무것도 하지 않는다 (개발 서버).
// 대기열이 막히면 매시 작업이 돌지 않아 푸시가 끊기고, 감시가 2시간 뒤 실패로 본다.
export async function pushWorkerHeartbeat(
  env: Record<string, string | undefined> = process.env,
  doFetch: typeof fetch = fetch,
): Promise<"sent" | "skipped" | "failed"> {
  const url = env.MONITOR_WORKER_PUSH_URL;
  const token = env.MONITOR_WORKER_PUSH_TOKEN;
  if (!url || !token) return "skipped";
  try {
    const response = await doFetch(`${url}?success=true`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`응답 ${response.status}`);
    return "sent";
  } catch (error) {
    // 감시가 안 받아도 worker 일은 계속한다 (감시 쪽에서 끊긴 것으로 보인다)
    console.error("[worker] 감시에 알리지 못했습니다", error instanceof Error ? error.message : error);
    return "failed";
  }
}
