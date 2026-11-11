import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDatabases } from "@openstudio/database";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { workflowIssues, type WorkflowProject, type WorkflowStep } from "@openstudio/shared/workflow";
import { transaction } from "./storage";
import { mutateWorkflow, projectIn, recoverWorkflowTasks, workflowManifest } from "./workflows";
import { processWorkflowTask } from "./workflow-agent";
import { dispatch } from "./api-server";

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
function streamTool(name: string, args: object, before?: () => Promise<void>): StreamFn {
  return async (model) => {
    await before?.();
    const stream = new AssistantMessageEventStream();
    const message = { role: "assistant" as const, content: [{ type: "toolCall" as const, id: crypto.randomUUID(), name, arguments: JSON.parse(JSON.stringify(args)) }], api: model.api, provider: model.provider, model: model.id, stopReason: "toolUse" as const, timestamp: Date.now(), usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    stream.push({ type: "start", partial: message }); stream.push({ type: "done", reason: "toolUse", message }); stream.end(); return stream;
  };
}
async function run(project: WorkflowProject, stepId?: string, all = false, feedback?: string) {
  const response = await mutateWorkflow(alice, { action: "run", id: project.id, stepId, all, feedback, requestId: crypto.randomUUID(), consent: true });
  return response.task!;
}

describe("production preparation workflow", () => {
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
    expect(saved.logs.some((log) => log.text.includes("Pi 도구 호출: propose_workflow"))).toBe(true);
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
    project = (await mutateWorkflow(alice, { action: "save", ...project, steps: [step("b", ["a"]), step("a"), step("extra")], revision: project.revision })).project;
    expect(project.steps.map((item) => item.id)).toEqual(["b", "a", "extra"]);
    project = (await mutateWorkflow(alice, { action: "save", ...project, steps: project.steps.filter((item) => item.id !== "a") })).project;
    expect(workflowIssues(project)[0].message).toContain("없는 입력"); await expect(run(project, "b")).rejects.toMatchObject({ code: "invalid_workflow" });
    project = (await mutateWorkflow(alice, { action: "save", ...project, steps: [step("a", ["b"]), step("b", ["a"])] })).project;
    expect(workflowIssues(project).some((issue) => issue.message.includes("순환"))).toBe(true); await expect(run(project, "a")).rejects.toMatchObject({ code: "invalid_workflow" });
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
