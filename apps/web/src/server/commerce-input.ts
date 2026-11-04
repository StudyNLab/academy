import { z } from "zod";

// 운영자 상품 화면(AD-07) API 입력 형식

export const productName = z.string().trim().min(2, { error: "상품 이름을 적어 주세요." }).max(100);

export const wonInput = z
  .number({ error: "금액을 적어 주세요." })
  .int({ error: "금액은 원 단위 정수입니다." })
  .min(0, { error: "금액은 0원 이상입니다." })
  .max(10_000_000, { error: "금액이 너무 큽니다." });

/** 수강 기간 · 늘리는 날수. null 이면 무제한 */
export const accessDaysInput = z.number().int().min(1).max(3650).nullable();

/** 시행 시각 (비우면 지금부터) */
export const effectiveFromInput = z.iso.datetime({ offset: true }).nullish();
