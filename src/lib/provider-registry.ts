import type { ProviderId, TaskKind } from "./types";

export const PROVIDERS = [
  { id: "elevenlabs", name: "ElevenLabs", methods: ["api-key"], tasks: ["audio"], baseURL: "https://api.elevenlabs.io/v1", description: "텍스트 음성 변환 · 계정 보이스 · MP3" },
  { id: "openai", name: "OpenAI", methods: ["oauth", "api-key"], tasks: ["text"], baseURL: "https://api.openai.com/v1", description: "ChatGPT 구독 · OpenAI API" },
  { id: "byteplus", name: "BytePlus ModelArk", methods: ["api-key"], tasks: ["image", "video", "text"], baseURL: "https://ark.ap-southeast.bytepluses.com/api/v3", description: "ModelArk 직접 연결 · Seedream 이미지 · 영상 작업 API" },
  { id: "openrouter", name: "OpenRouter", methods: ["oauth", "api-key"], tasks: ["text", "image", "video"], baseURL: "https://openrouter.ai/api/v1", description: "OAuth PKCE · 개인 API 크레딧" },
  { id: "anthropic", name: "Anthropic / Claude", methods: ["api-key"], tasks: ["text"], baseURL: "https://api.anthropic.com/v1", description: "Claude API · 구독 OAuth는 지원하지 않음" },
  { id: "google", name: "Google Gemini", methods: ["api-key"], tasks: ["text"], baseURL: "https://generativelanguage.googleapis.com/v1beta", description: "Google AI Studio API 키" },
  { id: "fal", name: "fal.ai", methods: ["api-key"], tasks: ["image", "video"], baseURL: "https://api.fal.ai/v1", description: "fal.ai 직접 연결 · 이미지·영상 Queue API" },
  { id: "github-copilot", name: "GitHub Copilot", methods: ["oauth"], tasks: ["text"], baseURL: "https://api.githubcopilot.com", description: "구독 · Device OAuth" },
  { id: "xai", name: "xAI", methods: ["api-key"], tasks: ["text"], baseURL: "https://api.x.ai/v1", description: "Grok API 키" },
  { id: "deepseek", name: "DeepSeek", methods: ["api-key"], tasks: ["text"], baseURL: "https://api.deepseek.com", description: "DeepSeek API 키" },
  { id: "groq", name: "Groq", methods: ["api-key"], tasks: ["text"], baseURL: "https://api.groq.com/openai/v1", description: "Groq API 키" },
  { id: "mistral", name: "Mistral", methods: ["api-key"], tasks: ["text"], baseURL: "https://api.mistral.ai/v1", description: "Mistral API 키" },
] as const;

export function providerDefinition(id: ProviderId) { return PROVIDERS.find((provider) => provider.id === id)!; }
export function providerName(id: ProviderId) { return providerDefinition(id)?.name || id; }
export function modelTasks(model: { tasks?: TaskKind[] }) { return model.tasks || ["text"] as TaskKind[]; }

export function seedanceRestriction(id: string): string | undefined {
  if (!/seedance/i.test(id)) return;
  const version = /seedance[\/-]v?(\d+(?:\.\d+)?)/i.exec(id);
  if (!version || Number(version[1]) < 5) return "요청 기준은 Seedance 5.0 이상입니다. 이 모델은 기준을 충족하지 않아 실행하지 않습니다.";
}
