import "server-only";
import type { FileStore } from "@aionit/storage";
import { createS3StoreFromEnv } from "@aionit/storage";

const globalForStore = globalThis as unknown as { aionitStore?: FileStore };

/** 파일 저장소 (Garage). 설정은 S3_* 환경변수 */
export function getStore(): FileStore {
  globalForStore.aionitStore ??= createS3StoreFromEnv();
  return globalForStore.aionitStore;
}
