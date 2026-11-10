export async function studioApi<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/${path}`, { ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}), cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "요청을 처리하지 못했습니다.");
  return data;
}
