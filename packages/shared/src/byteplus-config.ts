import { z } from "zod";

export const BYTEPLUS_BASE_URL = "https://ark.ap-southeast.bytepluses.com/api/v3";
export const BYTEPLUS_REGION = "ap-southeast-1" as const;
export const byteplusRegistrationSchema = z.object({
  id: z.string().trim().min(1).max(200).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/),
  kind: z.enum(["text", "image", "video"]),
  name: z.string().trim().max(100).optional(),
  baseModelId: z.string().trim().max(200).regex(/^[a-zA-Z0-9._:-]*$/).optional(),
});
export const byteplusSettingsSchema = z.object({
  region: z.literal(BYTEPLUS_REGION).default(BYTEPLUS_REGION),
  registrations: z.array(byteplusRegistrationSchema).max(20).default([]),
}).superRefine((settings, context) => {
  if (new Set(settings.registrations.map((entry) => entry.id)).size !== settings.registrations.length) context.addIssue({ code: "custom", message: "중복된 모델/endpoint ID가 있습니다." });
});
