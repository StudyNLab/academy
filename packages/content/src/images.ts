// 그림: 파일 앞 바이트로 형식 확인 (확장자를 믿지 않는다) ➔ WebP 로 바꾸기. SVG 는 받지 않는다 (규격 3.2)
import sharp from "sharp";
import { LIMITS } from "./spec";

export type ImageFormat = "png" | "jpeg" | "webp";

export function sniffImage(bytes: Buffer): ImageFormat | null {
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

export interface ConvertedImage {
  webp: Buffer;
  width: number;
  height: number;
}

/** 화면에 쓸 WebP 하나로 바꾼다. 가로 1440px 보다 크면 줄인다 (교재 본문 폭 760px 의 2배 정도) */
export async function toWebp(bytes: Buffer, maxWidth = 1440): Promise<ConvertedImage> {
  const image = sharp(bytes, { limitInputPixels: LIMITS.imagePixels, failOn: "error" });
  const meta = await image.metadata();
  if (!meta.width || !meta.height) throw new Error("그림 크기를 읽을 수 없습니다");
  const { data, info } = await image
    .rotate() // EXIF 방향대로 세우고, 메타데이터(EXIF · GPS)는 버린다
    .resize({ width: Math.min(meta.width, maxWidth), withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true });
  return { webp: data, width: info.width, height: info.height };
}
