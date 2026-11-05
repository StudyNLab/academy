// worker ➔ 감시(Gatus) 푸시 (M10). 설정이 없으면 보내지 않고, 감시가 안 받아도 worker 는 멈추지 않는다
import { describe, expect, it } from "vitest";
import { pushWorkerHeartbeat } from "../../worker/src/monitor";

describe("worker 감시 푸시", () => {
  it("주소 · 토큰이 있으면 Bearer 토큰으로 success=true 를 보낸다", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const env = {
      MONITOR_WORKER_PUSH_URL: "http://gatus:8080/api/v1/endpoints/app_worker/external",
      MONITOR_WORKER_PUSH_TOKEN: "t0ken",
    };
    expect(await pushWorkerHeartbeat(env, fake)).toBe("sent");
    expect(calls[0]!.url).toBe("http://gatus:8080/api/v1/endpoints/app_worker/external?success=true");
    expect(calls[0]!.init).toMatchObject({ method: "POST", headers: { authorization: "Bearer t0ken" } });
  });

  it("설정이 없으면 건너뛰고, 실패해도 던지지 않는다", async () => {
    const boom = (async () => {
      throw new Error("연결 안 됨");
    }) as unknown as typeof fetch;
    expect(await pushWorkerHeartbeat({}, boom)).toBe("skipped");
    const env = { MONITOR_WORKER_PUSH_URL: "http://gatus:8080/x", MONITOR_WORKER_PUSH_TOKEN: "t" };
    expect(await pushWorkerHeartbeat(env, boom)).toBe("failed");
    const notOk = (async () => new Response("", { status: 401 })) as unknown as typeof fetch;
    expect(await pushWorkerHeartbeat(env, notOk)).toBe("failed");
  });
});
