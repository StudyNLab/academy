import "server-only";
import type { FileStore } from "@aionit/storage";
import { createS3StoreFromEnv } from "@aionit/storage";

const globalForStore = globalThis as unknown as { aionitStore?: FileStore; aionitMedia?: FileStore };

/** 파일 저장소 (Garage). 설정은 S3_* 환경변수 */
export function getStore(): FileStore {
  globalForStore.aionitStore ??= createS3StoreFromEnv();
  return globalForStore.aionitStore;
}

/** 영상 버킷 (변환한 HLS · 자막). 테스트 서버는 Caddy 가 토큰 확인 후 Garage 웹 주소에서 바로 내준다 */
export function getMediaStore(): FileStore {
  globalForStore.aionitMedia ??= createS3StoreFromEnv(process.env, "S3_MEDIA_BUCKET");
  return globalForStore.aionitMedia;
}
