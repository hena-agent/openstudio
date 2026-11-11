import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDatabases } from "@openstudio/database";
import { mutateWorkflow, projectIn } from "./workflows";
import { processWorkflowTask } from "./workflow-agent";
import { transaction } from "./storage";
import { startJobRunner } from "./job-runner";

let directory: string;
const workspace = "a".repeat(64), account = "6692bc16-ee4b-443d-b996-6aad5f1099ff";
beforeEach(async () => { directory = await mkdtemp(path.join(tmpdir(), "studio-pi-")); vi.stubEnv("OPENSTUDIO_DATA_DIR", directory); vi.stubEnv("OPENSTUDIO_ENCRYPTION_KEY", "c".repeat(64)); });
afterEach(async () => { closeDatabases(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); await rm(directory, { recursive: true, force: true }); });
async function setup(provider: "openai" | "deepseek", method: "oauth" | "api-key" = "api-key") {
  await transaction(workspace, (data) => { data.connections.push({ id: account, provider, method, label: "Test", createdAt: "now", secret: method === "oauth" ? "subscription-access-token" : "sk-private-key", refreshToken: method === "oauth" ? "private-refresh" : undefined, clientId: method === "oauth" ? "app-client" : undefined, expiresAt: Date.now() + 3_600_000, scopes: ["chatgpt.tokens.use.direct"], planEnabled: true, baseURL: provider === "openai" ? "https://api.openai.com/v1" : "https://api.deepseek.com", models: [{ id: "text-model", name: "Text", tasks: ["text"], endpoints: [provider === "openai" ? "/responses" : "/chat/completions"], metadata: { tools: true } }] }); });
  let project = (await mutateWorkflow(workspace, { action: "create", name: "Preparation", brief: "Prepare", agent: { connectionId: account, modelId: "text-model" } })).project;
  project = (await mutateWorkflow(workspace, { action: "save", ...project, steps: [{ id: "script", name: "Script", kind: "text", instruction: "Write a short script", inputs: [], review: true }] })).project;
  const task = (await mutateWorkflow(workspace, { action: "run", id: project.id, stepId: "script", requestId: crypto.randomUUID(), consent: true })).task!;
  return { project, task };
}
const sse = (events: unknown[]) => new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "Content-Type": "text/event-stream" } });
describe("Pi SDK with explicit OpenStudio credentials", () => {
  it("executes a real completions tool call through Pi and never calls a media endpoint", async () => {
    const { project, task } = await setup("deepseek");
    const send = vi.fn().mockResolvedValue(sse([
      { id: "completion", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "call-1", type: "function", function: { name: "submit_result", arguments: JSON.stringify({ content: "Preparation via Pi" }) } }] }, finish_reason: null }] },
      { id: "completion", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
    ])); vi.stubGlobal("fetch", send);
    const runner = await startJobRunner({ interval: 10 });
    try { await vi.waitFor(async () => expect(await transaction(workspace, (data) => projectIn(data, project.id).states.script.status)).toBe("review")); }
    finally { await runner.stop(); }
    const saved = await transaction(workspace, (data) => projectIn(data, project.id)); expect(saved.states.script.status).toBe("review"); expect(saved.artifacts[0].content).toBe("Preparation via Pi");
    expect(send).toHaveBeenCalledTimes(1); expect(String(send.mock.calls[0][0])).toContain("/chat/completions");
    const init = send.mock.calls[0][1]; expect(new Headers(init.headers).get("Authorization")).toBe("Bearer sk-private-key"); expect(JSON.parse(init.body).tools.some((tool: { function: { name: string } }) => tool.function.name === "submit_result")).toBe(true);
  });
  it.each(["sse", "completed-json"])("supports ChatGPT subscription %s tool results without API-only options", async (format) => {
    const { project, task } = await setup("openai", "oauth");
    const response = { id: "response-1", object: "response", status: "completed", model: "text-model", output: [{ type: "function_call", id: "fc-1", call_id: "call-1", name: "submit_result", arguments: JSON.stringify({ content: "Subscription preparation" }), status: "completed" }], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
    const send = vi.fn().mockResolvedValue(format === "completed-json" ? Response.json(response) : sse([{ type: "response.created", response: { id: response.id } }, { type: "response.output_item.done", output_index: 0, item: response.output[0] }, { type: "response.completed", response }])); vi.stubGlobal("fetch", send);
    await processWorkflowTask(workspace, task.id);
    expect(await transaction(workspace, (data) => projectIn(data, project.id).states.script.status)).toBe("review");
    expect(send).toHaveBeenCalledTimes(1); const body = JSON.parse(send.mock.calls[0][1].body);
    expect(body.stream).toBe(true); expect(body.store).toBe(false); expect(body).not.toHaveProperty("max_output_tokens"); expect(body).not.toHaveProperty("temperature");
    expect(new Headers(send.mock.calls[0][1].headers).get("Authorization")).toBe("Bearer subscription-access-token");
  });
  it("does not retry an error or persist raw provider errors containing credentials", async () => {
    const { project, task } = await setup("deepseek");
    const send = vi.fn().mockResolvedValue(Response.json({ error: { message: "private credential sk-private-key echoed by upstream", type: "authentication_error" } }, { status: 401 })); vi.stubGlobal("fetch", send);
    await processWorkflowTask(workspace, task.id);
    const saved = await transaction(workspace, (data) => ({ project: projectIn(data, project.id), task: data.workflowTasks![0] }));
    expect(saved.task.status).toBe("failed"); expect(saved.task.error).toContain("인증"); expect(JSON.stringify(saved.project)).not.toContain("sk-private-key"); expect(saved.task.error).not.toContain("sk-private-key"); expect(send).toHaveBeenCalledTimes(1);
  });
});
