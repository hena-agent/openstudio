import { mkdtemp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDatabases } from "@openstudio/database";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { workflowIssues, productionSettingsSchema, type WorkflowProject, type WorkflowStep } from "@openstudio/shared/workflow";
import { transaction } from "./storage";
import { mutateWorkflow, projectIn, recoverWorkflowTasks, saveProductionPreset, sessionIn, workflowManifest, workflowResult } from "./workflows";
import { processWorkflowTask } from "./workflow-agent";
import { dispatch } from "./api-server";
import { saveMedia } from "./assets";

const alice = "a".repeat(64), bob = "b".repeat(64), account = "6692bc16-ee4b-443d-b996-6aad5f1099ff";
const binding = { connectionId: account, modelId: "text-model" };
let directory: string;
const step = (id: string, inputs: string[] = [], review = true, kind: WorkflowStep["kind"] = "text"): WorkflowStep => ({ id, name: id, kind, instruction: `Prepare ${id}`, inputs, review });
const outputs = [{ id: "portrait", name: "세로", format: "mp4" as const, sourceStepId: "export", width: 1080, height: 1920, durationSeconds: 30 }, { id: "landscape", name: "가로", format: "webm" as const, sourceStepId: "export", width: 1920, height: 1080, durationSeconds: 30 }];
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "studio-workflows-")); vi.stubEnv("OPENSTUDIO_DATA_DIR", directory); vi.stubEnv("OPENSTUDIO_ENCRYPTION_KEY", "c".repeat(64)); vi.stubEnv("OPENSTUDIO_WORKSPACE_MODE", "session"); vi.stubEnv("OPENSTUDIO_FRONTEND_ORIGIN", "http://127.0.0.1:3456");
  await transaction(alice, (data) => { data.connections.push({ id: account, provider: "deepseek", label: "Test", method: "api-key", createdAt: "now", secret: "private-account-secret", baseURL: "https://api.deepseek.com", models: [{ id: "text-model", name: "Text", endpoints: ["/chat/completions"], tasks: ["text"], metadata: { tools: true } }] }); });
});
afterEach(async () => { closeDatabases(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); await rm(directory, { recursive: true, force: true }); });
async function create(steps: WorkflowStep[] = []) {
  const { project } = await mutateWorkflow(alice, { action: "create", name: "Project", brief: "Prepare a studio production", agent: binding });
  return (await mutateWorkflow(alice, { action: "save", id: project.id, revision: project.revision, name: project.name, brief: project.brief, agent: binding, steps, outputs: steps.some((item) => item.id === "export") ? outputs : [] })).project;
}
const get = (id: string) => transaction(alice, (data) => structuredClone(projectIn(data, id)));
const getSession = (projectId: string, id: string) => transaction(alice, (data) => structuredClone(sessionIn(data, projectId, id)));
async function startSession(project: WorkflowProject, name = "영상 A") {
  return (await mutateWorkflow(alice, { action: "start-session", id: project.id, revision: project.revision, requestId: crypto.randomUUID(), name, brief: `${name}의 구체적인 주제`, references: [] })).session!;
}
function streamTool(name: string, args: object, before?: () => Promise<void>): StreamFn {
  return async (model) => {
    await before?.();
    const stream = new AssistantMessageEventStream();
    const message = { role: "assistant" as const, content: [{ type: "toolCall" as const, id: crypto.randomUUID(), name, arguments: JSON.parse(JSON.stringify(name === "propose_workflow" ? { scope: "single-video", ...args } : args)) }], api: model.api, provider: model.provider, model: model.id, stopReason: "toolUse" as const, timestamp: Date.now(), usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    stream.push({ type: "start", partial: message }); stream.push({ type: "done", reason: "toolUse", message }); stream.end(); return stream;
  };
}
async function run(project: WorkflowProject, stepId?: string, all = false, feedback?: string) {
  const response = await mutateWorkflow(alice, { action: "run", id: project.id, stepId, all, feedback, requestId: crypto.randomUUID(), consent: true });
  return response.task!;
}

describe("production preparation workflow", () => {
  it("uses a step's own account/model and keeps it frozen when the template returns to inheritance", async () => {
    const other = "79dbeb4c-1424-4845-91e6-20c87b289c5f";
    await transaction(alice, (data) => { data.connections.push({ id: other, provider: "openai", label: "Code account", method: "api-key", secret: "sk-mock-code-key", baseURL: "https://api.openai.com/v1", createdAt: "now", models: [{ id: "code-model", name: "Code Model", endpoints: ["/responses"], tasks: ["text"], metadata: { tools: true } }] }); });
    let project = await create([step("script", [], false), { ...step("code", ["script"], false, "code"), agent: { connectionId: other, modelId: "code-model" } }]);
    const session = await startSession(project);
    project = (await mutateWorkflow(alice, { action: "save", ...project, steps: project.steps.map((item) => ({ ...item, agent: undefined })) })).project;
    await transaction(alice, (data) => { data.connections.find((item) => item.id === other)!.models = []; });
    const first = (await mutateWorkflow(alice, { action: "run", id: project.id, sessionId: session.id, stepId: "script", requestId: crypto.randomUUID(), consent: true })).task!;
    await processWorkflowTask(alice, first.id, async (model, context, options) => { expect(model.id).toBe("text-model"); expect(model.provider).toBe("deepseek"); return streamTool("submit_result", { content: "Script" })(model, context, options); });
    const second = (await mutateWorkflow(alice, { action: "run", id: project.id, sessionId: session.id, stepId: "code", requestId: crypto.randomUUID(), consent: true })).task!;
    await processWorkflowTask(alice, second.id, async (model, context, options) => { expect(model.id).toBe("code-model"); expect(model.provider).toBe("openai"); return streamTool("submit_result", { content: "<svg/>" })(model, context, options); });
    const saved = await getSession(project.id, session.id); expect(saved.states.code.status).toBe("complete"); expect(saved.steps[1].agent?.connectionId).toBe(other);
    const fresh = await startSession(project, "Inherited");
    const next = (await mutateWorkflow(alice, { action: "run", id: project.id, sessionId: fresh.id, stepId: "script", requestId: crypto.randomUUID(), consent: true })).task!;
    expect(await transaction(alice, (data) => data.workflowTasks!.find((item) => item.id === next.id)!.agent)).toEqual(binding);
    await expect(mutateWorkflow(alice, { action: "save", ...project, steps: [{ ...project.steps[0], agent: { connectionId: crypto.randomUUID(), modelId: "foreign" } }] })).rejects.toMatchObject({ code: "invalid_step_model" });
  });
  it("rejects future inputs in direct saves, agent proposals, old proposal application and new production starts", async () => {
    const project = await create([step("a"), step("b", ["a"])]), frozen = await startSession(project);
    const bad = [step("b", ["a"]), step("a")];
    await expect(mutateWorkflow(alice, { action: "save", ...project, steps: bad })).rejects.toMatchObject({ code: "invalid_workflow" });
    expect((await get(project.id)).revision).toBe(project.revision);
    const task = (await mutateWorkflow(alice, { action: "plan", id: project.id, requestId: crypto.randomUUID(), consent: true })).task!;
    await processWorkflowTask(alice, task.id, streamTool("propose_workflow", { name: "Wrong order", summary: "Wrong order", steps: bad, outputs: [] }));
    expect((await get(project.id)).proposals).toHaveLength(0);
    const badModel = (await mutateWorkflow(alice, { action: "plan", id: project.id, requestId: crypto.randomUUID(), consent: true })).task!;
    await processWorkflowTask(alice, badModel.id, streamTool("propose_workflow", { name: "Unknown account", summary: "Invalid model binding", steps: [{ ...step("a"), agent: { connectionId: crypto.randomUUID(), modelId: "foreign" } }], outputs: [] }));
    expect((await get(project.id)).proposals).toHaveLength(0);
    const proposalId = crypto.randomUUID();
    await transaction(alice, (data) => { projectIn(data, project.id).proposals.push({ id: proposalId, name: "Legacy proposal", summary: "Old order", steps: bad, outputs: [], taskId: task.id, createdAt: "now", basedOnRevision: project.revision }); });
    await expect(mutateWorkflow(alice, { action: "apply-proposal", id: project.id, revision: project.revision, proposalId })).rejects.toMatchObject({ code: "invalid_workflow" });
    await transaction(alice, (data) => { projectIn(data, project.id).steps = bad; });
    await expect(startSession(await get(project.id), "Invalid")).rejects.toMatchObject({ code: "invalid_workflow" });
    expect((await getSession(project.id, frozen.id)).steps).toEqual(project.steps);
  });
  it("keeps frozen pre-rule sessions runnable even when their existing DAG is not in array order", async () => {
    const project = await create([step("a", [], false), step("b", ["a"], false)]), session = await startSession(project);
    await transaction(alice, (data) => { const previous = sessionIn(data, project.id, session.id); delete previous.inputOrderVersion; previous.steps.reverse(); });
    for (const stepId of ["a", "b"]) {
      const task = (await mutateWorkflow(alice, { action: "run", id: project.id, sessionId: session.id, stepId, requestId: crypto.randomUUID(), consent: true })).task!;
      await processWorkflowTask(alice, task.id, streamTool("submit_result", { content: stepId }));
    }
    const saved = await getSession(project.id, session.id); expect(saved.steps.map((item) => item.id)).toEqual(["b", "a"]); expect(saved.states.b.status).toBe("complete");
  });
  it("recovers session work after reopening SQLite without replaying committed or ambiguous model calls", async () => {
    const project = await create([step("script")]), a = await startSession(project), b = await startSession(project, "B");
    const first = (await mutateWorkflow(alice, { action: "run", id: project.id, sessionId: a.id, stepId: "script", requestId: crypto.randomUUID(), consent: true })).task!;
    const second = (await mutateWorkflow(alice, { action: "run", id: project.id, sessionId: b.id, stepId: "script", requestId: crypto.randomUUID(), consent: true })).task!;
    await transaction(alice, (data) => {
      Object.assign(data.workflowTasks!.find((task) => task.id === first.id)!, { status: "running", runId: "old-process", result: { type: "artifact", content: "Committed session result" } });
      Object.assign(data.workflowTasks!.find((task) => task.id === second.id)!, { status: "running", runId: "old-process" });
    });
    closeDatabases();
    await transaction(alice, (data) => recoverWorkflowTasks(data));
    await transaction(alice, (data) => recoverWorkflowTasks(data));
    expect((await getSession(project.id, a.id)).artifacts).toHaveLength(1); expect((await getSession(project.id, a.id)).states.script.status).toBe("review");
    expect((await getSession(project.id, b.id)).artifacts).toHaveLength(0); expect((await getSession(project.id, b.id)).states.script.status).toBe("failed");
    expect(await transaction(alice, (data) => data.workflowTasks!.find((task) => task.id === second.id)!.status)).toBe("unknown"); expect((await get(project.id)).artifacts).toHaveLength(0);
  });
  it("freezes the entire production session and its model catalog across template edits and later steps", async () => {
    const original = await create([step("script"), step("code", ["script"], false, "code")]);
    const a = await startSession(original);
    const first = (await mutateWorkflow(alice, { action: "run", id: original.id, sessionId: a.id, stepId: "script", requestId: crypto.randomUUID(), consent: true, all: true })).task!;
    const updated = (await mutateWorkflow(alice, { action: "save", ...original, brief: "Different default topic", settings: productionSettingsSchema.parse({ tone: "New tone" }), steps: [{ ...original.steps[0], instruction: "Changed instruction" }, step("extra")] })).project;
    await transaction(alice, (data) => { data.connections[0].models[0].metadata!.context = 777; data.connections[0].baseURL = "https://changed.example.test"; });
    const b = await startSession(updated, "영상 B");
    const second = (await mutateWorkflow(alice, { action: "run", id: original.id, sessionId: b.id, stepId: "script", requestId: crypto.randomUUID(), consent: true })).task!;
    expect(first.sessionId).toBe(a.id); expect(second.sessionId).toBe(b.id);
    expect(await transaction(alice, (data) => data.workflowTasks!.find((task) => task.id === first.id)!.status)).toBe("queued");
    await processWorkflowTask(alice, first.id, streamTool("submit_result", { content: "Original session result" }));
    let saved = await getSession(original.id, a.id); expect(saved.steps).toEqual(original.steps); expect(saved.sourceRevision).toBe(original.revision); expect(saved.states.script.status).toBe("review"); expect(saved.artifacts[0].stale).toBe(false);
    await mutateWorkflow(alice, { action: "approve", id: original.id, sessionId: a.id, stepId: "script", artifactId: saved.states.script.artifactId });
    const queued = await transaction(alice, (data) => structuredClone(data.workflowTasks!.find((task) => task.sessionId === a.id && task.stepId === "code")!));
    expect(queued.snapshot.step?.instruction).toBe(original.steps[1].instruction); expect(queued.providerBaseURL).toBe("https://api.deepseek.com"); expect(queued.modelSnapshot.metadata?.context).toBeUndefined();
    await processWorkflowTask(alice, queued.id, streamTool("submit_result", { content: "<svg/>" }));
    saved = await getSession(original.id, a.id); expect(saved.states.code.status).toBe("complete"); expect((await getSession(original.id, b.id)).artifacts).toEqual([]); expect((await get(original.id)).artifacts).toEqual([]);
    expect(await transaction(alice, (data) => data.workflowTasks!.find((task) => task.id === second.id)!.modelSnapshot.metadata?.context)).toBe(777);
  });
  it("keeps session results, feedback, idempotency keys and approval targets isolated", async () => {
    const project = await create([step("script")]), a = await startSession(project), b = await startSession(project, "영상 B");
    const requestId = crypto.randomUUID(), input = { action: "run", id: project.id, sessionId: a.id, stepId: "script", requestId, feedback: "A only", consent: true };
    const task = (await mutateWorkflow(alice, input)).task!;
    expect((await mutateWorkflow(alice, input)).task!.id).toBe(task.id);
    await expect(mutateWorkflow(alice, { ...input, sessionId: b.id })).rejects.toMatchObject({ status: 409 });
    await expect(mutateWorkflow(alice, { action: "note", id: project.id, sessionId: b.id, taskId: task.id, text: "Wrong session" })).rejects.toMatchObject({ status: 409 });
    await processWorkflowTask(alice, task.id, streamTool("submit_result", { content: "A result" }));
    const saved = await getSession(project.id, a.id);
    await expect(mutateWorkflow(alice, { action: "approve", id: project.id, sessionId: b.id, stepId: "script", artifactId: saved.states.script.artifactId })).rejects.toMatchObject({ status: 409 });
    await expect(mutateWorkflow(bob, { action: "pause", id: project.id, sessionId: a.id })).rejects.toMatchObject({ status: 404 });
    const otherProject = await create([step("script")]);
    await expect(mutateWorkflow(alice, { action: "pause", id: otherProject.id, sessionId: a.id })).rejects.toMatchObject({ status: 404 });
    expect((await getSession(project.id, b.id)).logs).toEqual([]);
    const response = await dispatch(new Request("http://127.0.0.1:4567/api/workflows", { headers: { Cookie: `studio_session=${alice}` } }));
    const text = await response.text(); expect(text).not.toContain("runtimeModels"); expect(text).not.toContain("providerBaseURL"); expect(text).not.toContain("private-account-secret");
  });
  it("exposes only approved final results after all session steps finish, with owned real files", async () => {
    const project = await create([step("main", [], true, "manual"), step("cover", [], true, "manual")]), session = await startSession(project);
    const image = await saveMedia(alice, new Response(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1])), "image", "cover");
    await expect(mutateWorkflow(alice, { action: "edit-result", id: project.id, sessionId: session.id, revision: session.revision, stepId: "main", content: "Foreign file", assetIds: [crypto.randomUUID()] })).rejects.toMatchObject({ status: 404 });
    await mutateWorkflow(alice, { action: "edit-result", id: project.id, sessionId: session.id, revision: session.revision, stepId: "main", content: "Final script" });
    let saved = await getSession(project.id, session.id), main = saved.states.main.artifactId!;
    await mutateWorkflow(alice, { action: "approve", id: project.id, sessionId: session.id, stepId: "main", artifactId: main });
    await expect(workflowResult(alice, session.id, main)).rejects.toMatchObject({ status: 409 });
    await mutateWorkflow(alice, { action: "edit-result", id: project.id, sessionId: session.id, revision: session.revision, stepId: "cover", content: "Cover image", assetIds: [image.id] });
    saved = await getSession(project.id, session.id);
    await mutateWorkflow(alice, { action: "approve", id: project.id, sessionId: session.id, stepId: "cover", artifactId: saved.states.cover.artifactId });
    expect((await workflowResult(alice, session.id, main)).artifact.content).toBe("Final script");
    expect((await workflowResult(alice, session.id, saved.states.cover.artifactId!)).artifact.assetIds).toEqual([image.id]);
    await expect(workflowResult(bob, session.id, main)).rejects.toMatchObject({ status: 404 });
    await mutateWorkflow(alice, { action: "edit-result", id: project.id, sessionId: session.id, revision: session.revision, stepId: "main", content: "Revised script" });
    await expect(workflowResult(alice, session.id, main)).rejects.toMatchObject({ status: 409 });
  });
  it("migrates existing production history once and preserves it independently of later configuration edits", async () => {
    let project = await create([step("script", [], false)]); const task = await run(project, "script");
    await processWorkflowTask(alice, task.id, streamTool("submit_result", { content: "Legacy result" }));
    const request = () => dispatch(new Request("http://127.0.0.1:4567/api/workflows", { headers: { Cookie: `studio_session=${alice}` } }));
    const first = await (await request()).json(), second = await (await request()).json();
    expect(first.sessions).toHaveLength(1); expect(second.sessions[0].id).toBe(first.sessions[0].id); expect(first.sessions[0].legacy).toBe(true);
    project = await get(project.id); await mutateWorkflow(alice, { action: "save", ...project, steps: [] });
    const saved = await getSession(project.id, first.sessions[0].id); expect(saved.steps).toHaveLength(1); expect(saved.artifacts[0].content).toBe("Legacy result"); expect(saved.states.script.status).toBe("complete");
    expect(await transaction(alice, (data) => data.workflowTasks![0].sessionId)).toBe(saved.id);
  });
  it("rejects session definition edits and execution without a session at the HTTP boundary", async () => {
    const project = await create([step("script")]), requestId = crypto.randomUUID();
    const input = { action: "start-session", id: project.id, revision: project.revision, requestId, name: "Episode", brief: "Topic" };
    const a = (await mutateWorkflow(alice, input)).session!;
    expect((await mutateWorkflow(alice, input)).session!.id).toBe(a.id);
    await expect(mutateWorkflow(alice, { ...input, name: "Different" })).rejects.toMatchObject({ status: 409 });
    await expect(mutateWorkflow(alice, { ...input, requestId: crypto.randomUUID(), revision: project.revision - 1 })).rejects.toMatchObject({ status: 409 });
    const post = (body: object) => dispatch(new Request("http://127.0.0.1:4567/api/workflows", { method: "POST", headers: { Origin: "http://127.0.0.1:3456", "Content-Type": "application/json", Cookie: `studio_session=${alice}` }, body: JSON.stringify(body) }));
    expect((await post({ action: "save", ...project, sessionId: a.id, steps: [] })).status).toBe(409);
    expect((await post({ action: "run", id: project.id, requestId: crypto.randomUUID(), consent: true })).status).toBe(400);
    expect((await getSession(project.id, a.id)).steps).toEqual(project.steps);
  });
  it("keeps legacy results approvable without silently adding new settings or rewriting old plans", async () => {
    const initial = await create([step("script")]);
    await transaction(alice, (data) => {
      const project = projectIn(data, initial.id); delete project.settings; delete project.video; delete project.references; delete project.scope;
      const definitionHash = createHash("sha256").update(JSON.stringify({ step: project.steps[0], agent: project.agent, brief: project.brief })).digest("hex");
      const id = crypto.randomUUID(); project.artifacts.push({ id, stepId: "script", version: 1, content: "Legacy script", kind: "text", createdAt: "now", source: "agent", definitionHash, inputArtifacts: {} }); project.states.script = { status: "review", artifactId: id };
    });
    let project = await get(initial.id);
    project = (await mutateWorkflow(alice, { action: "approve", id: project.id, stepId: "script", artifactId: project.states.script.artifactId })).project;
    project = (await mutateWorkflow(alice, { action: "save", ...project })).project;
    expect(project.settings).toBeUndefined(); expect(project.video).toBeUndefined(); expect(project.scope).toBeUndefined(); expect(project.states.script.status).toBe("complete"); expect(project.artifacts[0].stale).not.toBe(true);
  });
  it("reuses isolated preset copies and checks preset revisions and asset ownership", async () => {
    const settings = productionSettingsSchema.parse({ brand: "Man School", tone: "차분하고 간결하게", budget: "편당 1만원 이하" });
    const preset = (await saveProductionPreset(alice, { name: "채널 기본값", settings, agent: binding })).preset;
    const project = (await mutateWorkflow(alice, { action: "create", name: "첫 영상", brief: "약속을 지키는 태도", presetId: preset.id })).project;
    expect(project.settings).toEqual(settings); expect(project.agent).toEqual(binding); expect(project.scope).toBe("single-video");
    const updated = (await saveProductionPreset(alice, { ...preset, settings: { ...settings, tone: "밝고 경쾌하게" } })).preset;
    expect(updated.revision).toBe(2); expect((await get(project.id)).settings?.tone).toBe(settings.tone);
    await expect(saveProductionPreset(alice, preset)).rejects.toMatchObject({ status: 409 });
    await expect(saveProductionPreset(bob, { ...preset, agent: undefined })).rejects.toMatchObject({ status: 404 });
    await expect(mutateWorkflow(bob, { action: "create", name: "Other", brief: "Other", presetId: preset.id })).rejects.toMatchObject({ status: 404 });
    const image = await saveMedia(alice, new Response(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1])), "image", "logo");
    await expect(saveProductionPreset(bob, { name: "Foreign image", settings: { references: [{ assetId: image.id, purpose: "로고" }] } })).rejects.toMatchObject({ status: 404 });
    const response = await dispatch(new Request("http://127.0.0.1:4567/api/workflows", { headers: { Cookie: `studio_session=${bob}` } }));
    const data = await response.json(); expect(data.presets).toEqual([]); expect(data.assets).toEqual([]);
  });
  it("creates the next video without carrying results, dialogue, approvals or per-video references", async () => {
    let source = await create([step("script", [], false), step("export", ["script"], false, "export")]);
    source = (await mutateWorkflow(alice, { action: "save", ...source, settings: productionSettingsSchema.parse({ brand: "Reusable brand", method: "code" }) })).project;
    for (const id of ["script", "export"]) { const task = await run(source, id); await processWorkflowTask(alice, task.id, streamTool("submit_result", { content: "Original result" })); }
    source = await get(source.id);
    const next = (await mutateWorkflow(alice, { action: "create", sourceProjectId: source.id, reuseSteps: true, name: "다음 영상", brief: "다른 하나의 주제" })).project;
    expect(next.id).not.toBe(source.id); expect(next.settings).toEqual(source.settings); expect(next.steps).toEqual(source.steps); expect(next.outputs).toEqual(source.outputs);
    expect(next.brief).toBe("다른 하나의 주제"); expect(next.artifacts).toEqual([]); expect(next.logs).toEqual([]); expect(next.proposals).toEqual([]); expect(next.references).toEqual([]); expect(next.autoRun).toBe(false);
    expect(Object.values(next.states).every((state) => state.status === "idle" && !state.artifactId)).toBe(true);
    const fresh = (await mutateWorkflow(alice, { action: "create", sourceProjectId: source.id, name: "설정만 복사", brief: "세 번째 주제" })).project;
    expect(fresh.steps).toEqual([]); expect(fresh.settings).toEqual(source.settings); expect((await get(source.id)).artifacts).toHaveLength(2);
    await expect(mutateWorkflow(bob, { action: "create", sourceProjectId: source.id, name: "Foreign", brief: "Foreign" })).rejects.toMatchObject({ status: 404 });
  });
  it("supplies previous questions and answers with fixed single-video scope and saved production defaults", async () => {
    let project = await create();
    project = (await mutateWorkflow(alice, { action: "save", ...project, brief: "한 편의 약속과 책임 이야기", settings: productionSettingsSchema.parse({ brand: "Man School", method: "image", tone: "차분한 말투" }), video: { width: 1920, height: 1080, durationSeconds: 45 } })).project;
    const first = (await mutateWorkflow(alice, { action: "plan", id: project.id, requestId: crypto.randomUUID(), consent: true })).task!;
    await processWorkflowTask(alice, first.id, streamTool("ask_user", { question: "이번 편은 약속과 책임 중 어느 쪽을 중심으로 할까요?" }));
    const second = (await mutateWorkflow(alice, { action: "plan", id: project.id, feedback: "약속이요. 이미 정한 말투를 유지해 주세요.", requestId: crypto.randomUUID(), consent: true })).task!;
    let inspected = false;
    await processWorkflowTask(alice, second.id, async (model, context, options) => {
      inspected = true;
      const system = JSON.stringify(context.messages.filter((item) => item.role === "system"));
      expect(system).toContain("EXACTLY ONE VIDEO"); expect(system).toContain("Do not repeatedly ask");
      const message = context.messages.find((item) => item.role === "user")!;
      const payload = JSON.parse((message.content as { type: string; text: string }[]).find((item) => item.type === "text")!.text);
      expect(payload.scope).toBe("single-video"); expect(payload.settings.brand).toBe("Man School"); expect(payload.video.durationSeconds).toBe(45);
      expect(payload.conversation.some((item: { role: string; text: string }) => item.role === "assistant" && item.text.includes("어느 쪽"))).toBe(true);
      expect(payload.feedback).toContain("약속이요");
      return streamTool("propose_workflow", { name: "약속에 대한 영상 한 편", summary: "한 편의 원고와 출력", steps: [step("script")], outputs: [] })(model, context, options);
    });
    expect(inspected).toBe(true); expect((await get(project.id)).proposals[0].scope).toBe("single-video");
  });
  it("snapshots production settings and invalidates results prepared before a settings change", async () => {
    const project = await create([step("script")]), task = await run(project, "script");
    await processWorkflowTask(alice, task.id, streamTool("submit_result", { content: "Old style" }, async () => {
      await mutateWorkflow(alice, { action: "save", ...project, settings: productionSettingsSchema.parse({ tone: "New style" }) });
    }));
    const saved = await get(project.id); expect(saved.states.script.status).toBe("stale");
    expect(await transaction(alice, (data) => data.workflowTasks!.find((item) => item.id === task.id)!.snapshot.settings?.tone)).toBe("");
    await expect(mutateWorkflow(alice, { action: "approve", id: project.id, stepId: "script", artifactId: saved.states.script.artifactId })).rejects.toMatchObject({ status: 409 });
  });
  it.each(["image", "text"])("delivers reference images only to image-capable models (%s)", async (capability) => {
    const image = await saveMedia(alice, new Response(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1])), "image", "brand-logo");
    await transaction(alice, (data) => { data.connections[0].models[0].metadata!.input = ["text", ...(capability === "image" ? ["image"] : [])]; });
    let project = await create(); project = (await mutateWorkflow(alice, { action: "save", ...project, settings: productionSettingsSchema.parse({ references: [{ assetId: image.id, purpose: "공통 로고" }] }) })).project;
    const task = (await mutateWorkflow(alice, { action: "plan", id: project.id, requestId: crypto.randomUUID(), consent: true })).task!;
    let inspected = false;
    await processWorkflowTask(alice, task.id, async (model, context, options) => {
      inspected = true; const content = context.messages.find((item) => item.role === "user")!.content as { type: string; text?: string; data?: string }[];
      expect(content.filter((item) => item.type === "image")).toHaveLength(capability === "image" ? 1 : 0);
      const prompt = JSON.parse(content.find((item) => item.type === "text")!.text!);
      expect(prompt.referenceImages[0].purpose).toBe("공통 로고"); expect(prompt.referenceImageDelivery).toBe(capability === "image" ? "attached" : "descriptions-only");
      return streamTool("ask_user", { question: "이번 편의 주제를 알려 주세요." })(model, context, options);
    });
    expect(inspected).toBe(true); expect(JSON.stringify(await get(project.id))).not.toContain("iVBOR");
  });
  it("renames metadata independently, preserves queued work and ignores stale names in plan saves", async () => {
    const project = await create([step("script")]); const task = await run(project, "script");
    const renamed = (await mutateWorkflow(alice, { action: "rename", id: project.id, previousName: project.name, name: "New project name" })).project;
    expect(renamed.revision).toBe(project.revision); expect(renamed.brief).toBe(project.brief); expect(renamed.steps).toEqual(project.steps);
    expect(await transaction(alice, (data) => data.workflowTasks!.find((item) => item.id === task.id)!.status)).toBe("queued");
    const saved = (await mutateWorkflow(alice, { action: "save", ...project, brief: "User's independently edited goal" })).project;
    expect(saved.name).toBe("New project name"); expect(saved.brief).toBe("User's independently edited goal");
    await expect(mutateWorkflow(alice, { action: "rename", id: project.id, previousName: project.name, name: "Conflicting name" })).rejects.toMatchObject({ code: "name_conflict" });
    expect((await mutateWorkflow(alice, { action: "rename", id: project.id, previousName: project.name, name: "New project name" })).project.name).toBe("New project name");
    await expect(mutateWorkflow(bob, { action: "rename", id: project.id, previousName: "New project name", name: "Foreign" })).rejects.toMatchObject({ status: 404 });
    await expect(mutateWorkflow(alice, { action: "rename", id: project.id, previousName: "New project name", name: " " })).rejects.toThrow();
  });
  it("uses a real Pi tool loop to propose a plan, leaves it editable, and rejects stale proposals", async () => {
    const project = await create();
    const task = (await mutateWorkflow(alice, { action: "plan", id: project.id, requestId: crypto.randomUUID(), consent: true })).task!;
    await processWorkflowTask(alice, task.id, streamTool("propose_workflow", { name: "Agent plan", summary: "Editable plan", steps: [step("script"), step("code", ["script"], true, "code"), step("export", ["code"], false, "export")], outputs }));
    let saved = await get(project.id); expect(saved.steps).toHaveLength(0); expect(saved.proposals).toHaveLength(1);
    saved = (await mutateWorkflow(alice, { action: "apply-proposal", id: saved.id, revision: saved.revision, proposalId: saved.proposals[0].id })).project;
    expect(saved.steps).toHaveLength(3); expect(saved.outputs).toHaveLength(2);
    expect(saved.name).toBe(project.name);
    await expect(mutateWorkflow(alice, { action: "apply-proposal", id: saved.id, revision: saved.revision, proposalId: saved.proposals[0].id })).rejects.toMatchObject({ status: 409 });
    expect(saved.logs.some((log) => log.text.includes("작업 도구: propose_workflow"))).toBe(true);
  });
  it("pauses at review, approves an exact version once, auto-advances, and exports only preparation data", async () => {
    let project = await create([step("script"), step("code", ["script"], false, "code"), step("export", ["code"], false, "export")]);
    const task = await run(project, undefined, true); await processWorkflowTask(alice, task.id, streamTool("submit_result", { content: "Draft script" }));
    project = await get(project.id); expect(project.states.script.status).toBe("review");
    expect(await transaction(alice, (data) => data.workflowTasks!.length)).toBe(1);
    await expect(run(project, "code")).rejects.toThrow("검수");
    const approve = { action: "approve", id: project.id, stepId: "script", artifactId: project.states.script.artifactId };
    await mutateWorkflow(alice, approve); await mutateWorkflow(alice, approve);
    const codeTask = await transaction(alice, (data) => data.workflowTasks!.find((item) => item.stepId === "code")!);
    expect(await transaction(alice, (data) => data.workflowTasks!.length)).toBe(2);
    await processWorkflowTask(alice, codeTask.id, streamTool("submit_result", { content: "<svg><text>Prepared</text></svg>" }));
    const exportTask = await transaction(alice, (data) => data.workflowTasks!.find((item) => item.stepId === "export")!);
    await processWorkflowTask(alice, exportTask.id, streamTool("submit_result", { content: "Use the approved SVG as a shared scene." }));
    const manifest = await workflowManifest(alice, project.id); expect(manifest.rendered).toBe(false); expect(manifest.outputs).toHaveLength(2); expect(manifest.artifacts).toHaveLength(3);
    expect(JSON.stringify(manifest)).not.toContain("private-account-secret");
  });
  it("keeps result history and invalidates dependent results when an upstream result changes", async () => {
    let project = await create([step("script", [], false), step("export", ["script"], false, "export")]);
    for (const id of ["script", "export"]) { const task = await run(project, id); await processWorkflowTask(alice, task.id, streamTool("submit_result", { content: id })); }
    project = await get(project.id); expect((await workflowManifest(alice, project.id)).rendered).toBe(false);
    project = (await mutateWorkflow(alice, { action: "edit-result", id: project.id, revision: project.revision, stepId: "script", content: "Revised script" })).project;
    expect(project.artifacts.filter((item) => item.stepId === "script")).toHaveLength(2); expect(project.states.export.status).toBe("stale");
    await expect(workflowManifest(alice, project.id)).rejects.toMatchObject({ status: 409 });
  });
  it("allows step insertion, deletion and reordering but never executes dangling or cyclic inputs", async () => {
    let project = await create([step("a"), step("b", ["a"])]);
    await expect(mutateWorkflow(alice, { action: "save", ...project, steps: [step("b", ["a"]), step("a")] })).rejects.toMatchObject({ code: "invalid_workflow" });
    project = (await mutateWorkflow(alice, { action: "save", ...project, steps: [step("extra"), step("a"), step("b", ["a"])], revision: project.revision })).project;
    expect(project.steps.map((item) => item.id)).toEqual(["extra", "a", "b"]);
    project = (await mutateWorkflow(alice, { action: "save", ...project, steps: project.steps.filter((item) => item.id !== "a") })).project;
    expect(workflowIssues(project)[0].message).toContain("없는 입력"); await expect(run(project, "b")).rejects.toMatchObject({ code: "invalid_workflow" });
    await expect(mutateWorkflow(alice, { action: "save", ...project, steps: [step("a", ["b"]), step("b", ["a"])] })).rejects.toMatchObject({ code: "invalid_workflow" });
    await expect(mutateWorkflow(alice, { action: "save", ...project, steps: [step("__proto__")] })).rejects.toThrow();
  });
  it("persists a user question and consumes review feedback in a subsequent preparation", async () => {
    let project = await create([step("script")]); const first = await run(project, "script");
    await processWorkflowTask(alice, first.id, streamTool("ask_user", { question: "누구를 위한 설명인가요?" })); project = await get(project.id);
    expect(project.states.script.status).toBe("needs_input"); expect(project.artifacts).toHaveLength(0);
    const second = await run(project, "script", false, "처음 배우는 사람을 위한 설명");
    expect(await transaction(alice, (data) => data.workflowTasks!.find((item) => item.id === second.id)!.snapshot.question)).toContain("누구");
    await processWorkflowTask(alice, second.id, streamTool("submit_result", { content: "쉽게 설명한 원고" }));
    project = await get(project.id); expect(project.states.script.status).toBe("review"); expect(project.artifacts[0].feedback).toContain("처음 배우는");
  });
  it("delivers feedback arriving during a request before accepting a result", async () => {
    const project = await create([step("script")]), task = await run(project, "script"); let calls = 0;
    const stream: StreamFn = async (model, context, options) => {
      calls++;
      if (calls === 1) await mutateWorkflow(alice, { action: "note", id: project.id, taskId: task.id, text: "더 짧게 작성해 주세요." });
      else expect(JSON.stringify(context.messages)).toContain("더 짧게");
      return streamTool("submit_result", { content: calls === 1 ? "Old" : "반영한 원고" })(model, context, options);
    };
    await processWorkflowTask(alice, task.id, stream); const saved = await get(project.id);
    expect(calls).toBe(2); expect(saved.artifacts).toHaveLength(1); expect(saved.artifacts[0].content).toBe("반영한 원고");
    const retry = await run(saved, "script");
    expect(await transaction(alice, (data) => data.workflowTasks!.find((item) => item.id === retry.id)!.snapshot.feedbackHistory)).toContain("더 짧게 작성해 주세요.");
  });
  it("preserves a running snapshot and marks its result stale if the user edits its definition", async () => {
    const project = await create([step("script")]), task = await run(project, "script");
    await processWorkflowTask(alice, task.id, streamTool("submit_result", { content: "Result based on old settings" }, async () => {
      await mutateWorkflow(alice, { action: "save", ...project, steps: [{ ...project.steps[0], instruction: "New user instructions" }] });
    }));
    const saved = await get(project.id); expect(saved.steps[0].instruction).toBe("New user instructions"); expect(saved.states.script.status).toBe("stale");
    await expect(mutateWorkflow(alice, { action: "approve", id: saved.id, stepId: "script", artifactId: saved.states.script.artifactId })).rejects.toMatchObject({ status: 409 });
  });
  it("requires model consent, deduplicates submissions and rejects another workspace's project", async () => {
    const project = await create([step("script")]);
    await expect(mutateWorkflow(alice, { action: "run", id: project.id, stepId: "script", requestId: crypto.randomUUID(), consent: false })).rejects.toThrow();
    const input = { action: "run", id: project.id, stepId: "script", requestId: crypto.randomUUID(), consent: true };
    expect((await mutateWorkflow(alice, input)).task!.id).toBe((await mutateWorkflow(alice, input)).task!.id);
    await expect(mutateWorkflow(bob, input)).rejects.toMatchObject({ status: 404 });
    const response = await dispatch(new Request("http://127.0.0.1:4567/api/workflows", { headers: { Cookie: `studio_session=${alice}` } })); const text = await response.text();
    expect(text).not.toContain("private-account-secret"); expect(text).not.toContain("providerBaseURL");
    const other = await dispatch(new Request("http://127.0.0.1:4567/api/workflows", { headers: { Cookie: `studio_session=${bob}` } })); expect((await other.json()).projects).toEqual([]);
  });
  it("does not call a model for queued work whose step was edited or deleted before execution", async () => {
    const project = await create([step("script")]), task = await run(project, "script");
    await mutateWorkflow(alice, { action: "save", ...project, steps: [] });
    const stream = vi.fn(streamTool("submit_result", { content: "Should not run" }));
    await processWorkflowTask(alice, task.id, stream);
    expect(stream).not.toHaveBeenCalled();
    expect(await transaction(alice, (data) => data.workflowTasks!.find((item) => item.id === task.id)!.status)).toBe("failed");
    expect((await get(project.id)).artifacts).toHaveLength(0);
  });
  it("recovers a committed tool result without another model call and preserves ambiguous calls", async () => {
    const project = await create([step("script")]); const first = await run(project, "script");
    await transaction(alice, (data) => { const task = data.workflowTasks![0]; Object.assign(task, { status: "running", runId: "old-process", result: { type: "artifact", content: "Durably submitted" } }); recoverWorkflowTasks(data); });
    let saved = await get(project.id); expect(saved.states.script.status).toBe("review");
    const second = await run(saved, "script", false, "Revise");
    await transaction(alice, (data) => { const task = data.workflowTasks!.find((item) => item.id === second.id)!; Object.assign(task, { status: "running", runId: "old-process" }); recoverWorkflowTasks(data); });
    expect(await transaction(alice, (data) => data.workflowTasks!.find((item) => item.id === first.id)!.status)).toBe("completed");
    expect(await transaction(alice, (data) => data.workflowTasks!.find((item) => item.id === second.id)!.status)).toBe("unknown");
    saved = await get(project.id); expect(saved.artifacts).toHaveLength(1); expect(saved.states.script.status).toBe("failed");
  });
});
