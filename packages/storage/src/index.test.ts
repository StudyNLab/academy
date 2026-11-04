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

  it("나눠 올리기: 조각을 번호 차례로 잇고, 폴더째 지운다", async () => {
    const store = createMemoryStore();
    const id = await store.multipart.start("v/big.mp4", "video/mp4");
    await store.multipart.uploadPart("v/big.mp4", id, 2, Buffer.from("world"));
    await store.multipart.uploadPart("v/big.mp4", id, 1, Buffer.from("hello "));
    expect(await store.multipart.listParts("v/big.mp4", id)).toEqual([
      { partNumber: 1, size: 6 },
      { partNumber: 2, size: 5 },
    ]);
    await store.multipart.complete("v/big.mp4", id);
    expect((await store.getBuffer("v/big.mp4"))?.toString()).toBe("hello world");
    await store.put("v/x/1.ts", Buffer.from("1"), { contentType: "video/mp2t" });
    expect(await store.deletePrefix("v/")).toBe(2);
    await expect(store.deletePrefix("")).rejects.toThrow();
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

  it.skipIf(!process.env.S3_ACCESS_KEY_ID)(
    "개발 Garage 에 나눠 올리고 (5MB + 끝 조각) 폴더째 지운다",
    async () => {
      const store = createS3StoreFromEnv();
      const prefix = `test/multipart-${Date.now()}/`;
      const key = `${prefix}big.bin`;
      const first = Buffer.alloc(5 * 1024 * 1024, 1);
      const id = await store.multipart.start(key, "application/octet-stream");
      await store.multipart.uploadPart(key, id, 1, first);
      await store.multipart.uploadPart(key, id, 2, Buffer.from("tail"));
      expect((await store.multipart.listParts(key, id)).map((p) => p.size)).toEqual([first.length, 4]);
      await store.multipart.complete(key, id);
      expect((await store.getBuffer(key))?.length).toBe(first.length + 4);
      expect(await store.deletePrefix(prefix)).toBe(1);
      expect(await store.exists(key)).toBe(false);
    },
  );
});
