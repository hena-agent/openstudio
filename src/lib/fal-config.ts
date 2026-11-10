import { z } from "zod";

export const FAL_API_BASE = "https://api.fal.ai/v1";
export const FAL_CATEGORIES = ["text-to-image", "image-to-image", "text-to-video", "image-to-video"] as const;
export const FAL_CATEGORY_NAMES = { "text-to-image": "텍스트 → 이미지", "image-to-image": "이미지 → 이미지", "text-to-video": "텍스트 → 영상", "image-to-video": "이미지 → 영상" };

export function normalizeFalEndpointId(input: string) {
  let id = input.trim();
  if (id.length > 1000) throw new Error("fal endpoint ID가 너무 깁니다.");
  if (/^https?:\/\//i.test(id)) {
    const url = new URL(id);
    if (url.protocol !== "https:" || url.username || url.password || url.port || !["fal.ai", "www.fal.ai", "fal.run", "queue.fal.run"].includes(url.hostname)) throw new Error("공식 fal 모델 URL 또는 endpoint ID를 입력하세요.");
    id = url.pathname.replace(/^\/models\//, "").replace(/^\/+|\/+$/g, "");
    if (["fal.ai", "www.fal.ai"].includes(url.hostname)) id = id.replace(/\/api$/, "");
  }
  const parts = id.split("/");
  if (id.length > 300 || parts.length < 2 || parts.length > 12 || parts.some((part, index) => !/^[a-zA-Z0-9._-]+$/.test(part) || [".", ".."].includes(part) || part === "requests" && index >= 2)) throw new Error("fal 모델의 endpoint ID를 확인하세요. 작업 조회 URL은 사용할 수 없습니다.");
  return id;
}

export const falSettingsSchema = z.object({
  endpoints: z.array(z.string().transform((value, context) => {
    try { return normalizeFalEndpointId(value); }
    catch (error) { context.addIssue({ code: "custom", message: (error as Error).message }); return z.NEVER; }
  })).max(20).default([]),
}).superRefine((settings, context) => {
  if (new Set(settings.endpoints).size !== settings.endpoints.length) context.addIssue({ code: "custom", message: "중복된 fal endpoint ID가 있습니다." });
});
