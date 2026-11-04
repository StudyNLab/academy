import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { describe, expect, it } from "vitest";
import { createMemoryStore, createS3StoreFromEnv } from "./index";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });

describe("메모리 저장소 (테스트용)", () => {
  it("넣고 · 읽고 · 지운다", async () => {
    const store = createMemoryStore();
    await store.put("a/b.txt", Buffer.from("hello"), { contentType: "text/plain" });
    expect(await store.exists("a/b.txt")).toBe(true);
    expect((await store.getBuffer("a/b.txt"))?.toString()).toBe("hello");
    expect((await store.get("a/b.txt"))?.contentType).toBe("text/plain");
    await store.delete("a/b.txt");
    expect(await store.get("a/b.txt")).toBeNull();
  });
});

describe("S3 저장소 설정", () => {
  it("값이 비면 어느 이름이 빠졌는지 알려 준다 (값은 찍지 않는다)", () => {
    expect(() => createS3StoreFromEnv({ S3_ENDPOINT: "http://x" })).toThrow(
      "S3_REGION 이 설정되지 않았습니다",
    );
  });

  // 개발 VM 의 Garage 에 실제로 넣어 본다 (터널 · 설정이 있을 때만)
  it.skipIf(!process.env.S3_ACCESS_KEY_ID)("개발 Garage 에 넣고 · 읽고 · 지운다", async () => {
    const store = createS3StoreFromEnv();
    const key = `test/${Date.now()}.txt`;
    await store.put(key, Buffer.from("garage ok"), { contentType: "text/plain" });
    expect((await store.getBuffer(key))?.toString()).toBe("garage ok");
    await store.delete(key);
    expect(await store.exists(key)).toBe(false);
    expect(await store.get(key)).toBeNull();
  });
});
