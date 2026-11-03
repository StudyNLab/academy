// 파일 저장 어댑터 (docs/기술설계.md 2.2). 개발 · 테스트 서버는 Garage(S3 호환), 실오픈 때 S3 · R2 로 주소만 바꾼다.
// 앱은 이 인터페이스만 쓴다. 테스트는 메모리 저장소로 바꿔 끼운다.
import { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NoSuchKey,
  NotFound,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

export interface StoredObject {
  body: Readable;
  contentType: string | null;
  size: number | null;
}

export interface FileStore {
  put(key: string, body: Buffer | Readable, options: { contentType: string; size?: number }): Promise<void>;
  /** 없으면 null */
  get(key: string): Promise<StoredObject | null>;
  getBuffer(key: string): Promise<Buffer | null>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
}

export interface S3StoreOptions {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export function createS3Store(options: S3StoreOptions): FileStore {
  const client = new S3Client({
    endpoint: options.endpoint,
    region: options.region,
    forcePathStyle: true, // Garage 는 경로 방식 주소를 쓴다
    credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
  });
  const Bucket = options.bucket;
  const notFound = (error: unknown) =>
    error instanceof NoSuchKey ||
    error instanceof NotFound ||
    (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404;

  const store: FileStore = {
    async put(key, body, { contentType, size }) {
      await client.send(
        new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType, ContentLength: size }),
      );
    },
    async get(key) {
      try {
        const result = await client.send(new GetObjectCommand({ Bucket, Key: key }));
        return {
          body: result.Body as Readable,
          contentType: result.ContentType ?? null,
          size: result.ContentLength ?? null,
        };
      } catch (error) {
        if (notFound(error)) return null;
        throw error;
      }
    },
    async getBuffer(key) {
      const object = await store.get(key);
      if (!object) return null;
      const chunks: Buffer[] = [];
      for await (const chunk of object.body) chunks.push(Buffer.from(chunk as Uint8Array));
      return Buffer.concat(chunks);
    },
    async exists(key) {
      try {
        await client.send(new HeadObjectCommand({ Bucket, Key: key }));
        return true;
      } catch (error) {
        if (notFound(error)) return false;
        throw error;
      }
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
  };
  return store;
}

/** 환경변수(S3_*)에서 저장소를 만든다. 하나라도 비면 오류 */
export function createS3StoreFromEnv(env: Record<string, string | undefined> = process.env): FileStore {
  const read = (name: string) => {
    const value = env[name];
    if (!value) throw new Error(`${name} 이 설정되지 않았습니다`);
    return value;
  };
  return createS3Store({
    endpoint: read("S3_ENDPOINT"),
    region: read("S3_REGION"),
    bucket: read("S3_BUCKET"),
    accessKeyId: read("S3_ACCESS_KEY_ID"),
    secretAccessKey: read("S3_SECRET_ACCESS_KEY"),
  });
}

/** 테스트용: 메모리에 둔다 */
export function createMemoryStore(): FileStore & {
  objects: Map<string, { body: Buffer; contentType: string }>;
} {
  const objects = new Map<string, { body: Buffer; contentType: string }>();
  const toBuffer = async (body: Buffer | Readable) => {
    if (Buffer.isBuffer(body)) return body;
    const chunks: Buffer[] = [];
    for await (const chunk of body) chunks.push(Buffer.from(chunk as Uint8Array));
    return Buffer.concat(chunks);
  };
  return {
    objects,
    async put(key, body, { contentType }) {
      objects.set(key, { body: await toBuffer(body), contentType });
    },
    async get(key) {
      const object = objects.get(key);
      return object
        ? { body: Readable.from(object.body), contentType: object.contentType, size: object.body.length }
        : null;
    },
    async getBuffer(key) {
      return objects.get(key)?.body ?? null;
    },
    async exists(key) {
      return objects.has(key);
    },
    async delete(key) {
      objects.delete(key);
    },
  };
}
