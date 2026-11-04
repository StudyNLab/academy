// 파일 저장 어댑터 (docs/기술설계.md 2.2). 개발 · 테스트 서버는 Garage(S3 호환), 실오픈 때 S3 · R2 로 주소만 바꾼다.
// 앱은 이 인터페이스만 쓴다. 테스트는 메모리 저장소로 바꿔 끼운다.
import { Readable } from "node:stream";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  ListPartsCommand,
  NoSuchKey,
  NotFound,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
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
  /** 이 이름으로 시작하는 파일을 모두 지운다 (영상 폴더 등). 지운 개수 */
  deletePrefix(prefix: string): Promise<number>;
  /** 큰 파일 나눠 올리기 (영상 원본). 조각은 마지막 것 말고는 5MB 이상이어야 한다 (S3 규칙) */
  multipart: {
    start(key: string, contentType: string): Promise<string>;
    /** 조각 번호는 1부터. 같은 번호를 다시 올리면 덮어쓴다 */
    uploadPart(key: string, uploadId: string, partNumber: number, body: Buffer): Promise<void>;
    /** 올라간 조각 번호 · 크기 (이어 올리기 · 마무리 확인용) */
    listParts(key: string, uploadId: string): Promise<{ partNumber: number; size: number }[]>;
    /** 올라간 조각을 번호 차례로 이어 파일 하나로 만든다 */
    complete(key: string, uploadId: string): Promise<void>;
    abort(key: string, uploadId: string): Promise<void>;
  };
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

  async function allParts(key: string, uploadId: string) {
    const parts: { PartNumber: number; ETag: string; Size: number }[] = [];
    let PartNumberMarker: string | undefined;
    do {
      const page = await client.send(
        new ListPartsCommand({ Bucket, Key: key, UploadId: uploadId, PartNumberMarker }),
      );
      for (const p of page.Parts ?? [])
        parts.push({ PartNumber: p.PartNumber!, ETag: p.ETag!, Size: p.Size ?? 0 });
      PartNumberMarker = page.IsTruncated ? page.NextPartNumberMarker : undefined;
    } while (PartNumberMarker);
    return parts.sort((a, b) => a.PartNumber - b.PartNumber);
  }

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
    async deletePrefix(prefix) {
      if (!prefix.endsWith("/")) throw new Error("폴더 이름(/ 로 끝남)으로만 지웁니다");
      let removed = 0;
      let ContinuationToken: string | undefined;
      do {
        const page = await client.send(
          new ListObjectsV2Command({ Bucket, Prefix: prefix, ContinuationToken, MaxKeys: 1000 }),
        );
        const keys = (page.Contents ?? []).flatMap((o) => (o.Key ? [{ Key: o.Key }] : []));
        if (keys.length > 0) {
          await client.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: keys, Quiet: true } }));
          removed += keys.length;
        }
        ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (ContinuationToken);
      return removed;
    },
    multipart: {
      async start(key, contentType) {
        const result = await client.send(
          new CreateMultipartUploadCommand({ Bucket, Key: key, ContentType: contentType }),
        );
        if (!result.UploadId) throw new Error("나눠 올리기를 시작하지 못했습니다");
        return result.UploadId;
      },
      async uploadPart(key, uploadId, partNumber, body) {
        await client.send(
          new UploadPartCommand({
            Bucket,
            Key: key,
            UploadId: uploadId,
            PartNumber: partNumber,
            Body: body,
            ContentLength: body.length,
          }),
        );
      },
      async listParts(key, uploadId) {
        return (await allParts(key, uploadId)).map((p) => ({ partNumber: p.PartNumber, size: p.Size }));
      },
      async complete(key, uploadId) {
        const parts = (await allParts(key, uploadId)).map(({ PartNumber, ETag }) => ({ PartNumber, ETag }));
        await client.send(
          new CompleteMultipartUploadCommand({
            Bucket,
            Key: key,
            UploadId: uploadId,
            MultipartUpload: { Parts: parts },
          }),
        );
      },
      async abort(key, uploadId) {
        await client.send(new AbortMultipartUploadCommand({ Bucket, Key: key, UploadId: uploadId }));
      },
    },
  };
  return store;
}

/**
 * 환경변수(S3_*)에서 저장소를 만든다. 하나라도 비면 오류.
 * bucketVar: 다른 버킷을 쓸 때 (영상 변환 결과는 S3_MEDIA_BUCKET — docs/기술설계.md 5.2)
 */
export function createS3StoreFromEnv(
  env: Record<string, string | undefined> = process.env,
  bucketVar = "S3_BUCKET",
): FileStore {
  const read = (name: string) => {
    const value = env[name];
    if (!value) throw new Error(`${name} 이 설정되지 않았습니다`);
    return value;
  };
  return createS3Store({
    endpoint: read("S3_ENDPOINT"),
    region: read("S3_REGION"),
    bucket: read(bucketVar),
    accessKeyId: read("S3_ACCESS_KEY_ID"),
    secretAccessKey: read("S3_SECRET_ACCESS_KEY"),
  });
}

/** 테스트용: 메모리에 둔다 */
export function createMemoryStore(): FileStore & {
  objects: Map<string, { body: Buffer; contentType: string }>;
} {
  const objects = new Map<string, { body: Buffer; contentType: string }>();
  const uploads = new Map<string, { key: string; contentType: string; parts: Map<number, Buffer> }>();
  const upload = (key: string, uploadId: string) => {
    const found = uploads.get(uploadId);
    if (!found || found.key !== key) throw new Error("NoSuchUpload");
    return found;
  };
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
    async deletePrefix(prefix) {
      if (!prefix.endsWith("/")) throw new Error("폴더 이름(/ 로 끝남)으로만 지웁니다");
      let removed = 0;
      for (const key of [...objects.keys()])
        if (key.startsWith(prefix)) {
          objects.delete(key);
          removed += 1;
        }
      return removed;
    },
    multipart: {
      async start(key, contentType) {
        const uploadId = `mem-${uploads.size + 1}-${Date.now()}`;
        uploads.set(uploadId, { key, contentType, parts: new Map() });
        return uploadId;
      },
      async uploadPart(key, uploadId, partNumber, body) {
        upload(key, uploadId).parts.set(partNumber, Buffer.from(body));
      },
      async listParts(key, uploadId) {
        return [...upload(key, uploadId).parts]
          .map(([partNumber, body]) => ({ partNumber, size: body.length }))
          .sort((a, b) => a.partNumber - b.partNumber);
      },
      async complete(key, uploadId) {
        const found = upload(key, uploadId);
        const body = Buffer.concat([...found.parts].sort(([a], [b]) => a - b).map(([, part]) => part));
        objects.set(key, { body, contentType: found.contentType });
        uploads.delete(uploadId);
      },
      async abort(key, uploadId) {
        upload(key, uploadId);
        uploads.delete(uploadId);
      },
    },
  };
}
