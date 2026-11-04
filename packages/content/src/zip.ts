// zip 안전하게 풀기: 경로 탈출 · 링크 · 개수 · 크기(선언값과 실제 모두) · 압축 폭탄 막기
import { posix } from "node:path";
import type { Entry, ZipFile } from "yauzl";
import yauzl from "yauzl";
import { LIMITS } from "./spec";

export class PackageError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** zip 항목 이름을 검사해 패키지 안 상대 경로로 바꾼다. 위험하면 PackageError */
export function safeEntryPath(name: string): string {
  if (name.includes("\\")) throw new PackageError("ZIP_BAD_PATH", `역슬래시가 든 경로: ${name}`);
  if (name.includes("\0")) throw new PackageError("ZIP_BAD_PATH", "경로에 널 문자가 있습니다");
  if (name.startsWith("/") || /^[A-Za-z]:/.test(name)) {
    throw new PackageError("ZIP_BAD_PATH", `절대 경로는 받지 않습니다: ${name}`);
  }
  const normalized = posix.normalize(name);
  if (normalized.startsWith("../") || normalized === ".." || normalized.split("/").includes("..")) {
    throw new PackageError("ZIP_PATH_TRAVERSAL", `패키지 밖을 가리키는 경로: ${name}`);
  }
  return normalized.normalize("NFC");
}

/** yauzl 의 오류 ➔ 보고서 코드 */
function toPackageError(error: unknown): PackageError {
  if (error instanceof PackageError) return error;
  const message = (error as Error)?.message ?? String(error);
  if (/invalid relative path/.test(message))
    return new PackageError("ZIP_PATH_TRAVERSAL", `패키지 밖을 가리키는 경로: ${message}`);
  if (/absolute path|invalid characters/.test(message))
    return new PackageError("ZIP_BAD_PATH", `받을 수 없는 경로: ${message}`);
  if (/too many bytes|too few bytes|expected/.test(message)) {
    return new PackageError(
      "ZIP_ENTRY_TOO_LARGE",
      `적힌 크기와 실제로 풀린 크기가 다릅니다 (압축 폭탄 의심): ${message}`,
    );
  }
  return new PackageError("ZIP_INVALID", `zip 파일을 읽을 수 없습니다: ${message}`);
}

function open(buffer: Buffer): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(
      buffer,
      { lazyEntries: true, validateEntrySizes: true, strictFileNames: false, decodeStrings: true },
      (error, zip) => (error || !zip ? reject(error ?? new Error("zip 열기 실패")) : resolve(zip)),
    );
  });
}

function readEntry(zip: ZipFile, entry: Entry, limit: number, budget: { left: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) return reject(error ?? new Error("zip 항목 열기 실패"));
      const chunks: Buffer[] = [];
      let size = 0;
      stream.on("data", (chunk: Buffer) => {
        size += chunk.length;
        budget.left -= chunk.length;
        // 선언된 크기를 믿지 않고 실제로 풀린 양을 센다
        if (size > limit) {
          stream.destroy(new PackageError("ZIP_ENTRY_TOO_LARGE", `${entry.fileName} 이(가) 너무 큽니다`));
          return;
        }
        if (budget.left < 0) {
          stream.destroy(
            new PackageError("ZIP_TOO_LARGE_UNZIPPED", "풀린 크기가 한도를 넘었습니다 (압축 폭탄 의심)"),
          );
          return;
        }
        chunks.push(chunk);
      });
      stream.on("error", reject);
      stream.on("end", () => resolve(Buffer.concat(chunks)));
    });
  });
}

/**
 * zip 을 풀어 경로 ➔ 내용 맵으로 준다. `limitFor(path)` 가 null 이면 그 항목은 읽지 않고 건너뛴다 (규격 밖 파일).
 * 폴더 항목 · 심볼릭 링크는 건너뛴다 (링크는 따라가지 않는다).
 */
export async function readZip(
  buffer: Buffer,
  limitFor: (path: string) => number | null,
): Promise<{ files: Map<string, Buffer>; skipped: string[] }> {
  if (buffer.length > LIMITS.zipBytes)
    throw new PackageError("ZIP_TOO_LARGE", "zip 파일이 200MB 를 넘습니다");
  let zip: ZipFile;
  try {
    zip = await open(buffer);
  } catch (error) {
    throw new PackageError("ZIP_INVALID", `zip 파일을 열 수 없습니다: ${(error as Error).message}`);
  }
  if (zip.entryCount > LIMITS.entries) {
    zip.close();
    throw new PackageError("ZIP_TOO_MANY_ENTRIES", `파일이 너무 많습니다 (${zip.entryCount}개)`);
  }
  const files = new Map<string, Buffer>();
  const skipped: string[] = [];
  const budget = { left: LIMITS.unzippedBytes };

  return new Promise((resolve, reject) => {
    const fail = (error: unknown) => {
      zip.close();
      reject(toPackageError(error));
    };
    zip.on("error", fail);
    zip.on("end", () => resolve({ files, skipped }));
    zip.on("entry", (entry: Entry) => {
      void (async () => {
        try {
          const path = safeEntryPath(entry.fileName);
          const unixMode = (entry.externalFileAttributes >>> 16) & 0o170000;
          const isDir = path.endsWith("/") || entry.fileName.endsWith("/");
          if (isDir) return zip.readEntry();
          if (unixMode === 0o120000) {
            skipped.push(`${path} (링크)`);
            return zip.readEntry();
          }
          if (files.has(path)) throw new PackageError("ZIP_DUPLICATE", `같은 경로가 두 번 있습니다: ${path}`);
          const limit = limitFor(path);
          if (limit === null) {
            skipped.push(path);
            return zip.readEntry();
          }
          if (entry.uncompressedSize > limit) {
            throw new PackageError(
              "ZIP_ENTRY_TOO_LARGE",
              `${path} 이(가) 너무 큽니다 (${entry.uncompressedSize} bytes)`,
            );
          }
          files.set(path, await readEntry(zip, entry, limit, budget));
          zip.readEntry();
        } catch (error) {
          fail(error);
        }
      })();
    });
    zip.readEntry();
  });
}
