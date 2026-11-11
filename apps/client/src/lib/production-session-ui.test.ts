import { describe, expect, it } from "vitest";
import type { PreparationArtifact, ProductionSession, WorkflowLog, WorkflowProject, WorkflowTask } from "@openstudio/shared/workflow";
import { isProductionActivity, productionSessionStatus, resolveResultDraft, resultDraftDirty, resultDraftFor } from "./production-session-ui";

const artifact = (id: string, content: string): PreparationArtifact => ({ id, stepId: "script", version: 1, content, kind: "text", createdAt: "now", source: "user", definitionHash: "hash", inputArtifacts: {} });
describe("production session editing state", () => {
  it("collapses known legacy execution and approval events without rewriting saved logs", () => {
    const logs: WorkflowLog[] = [{ id: "start", role: "user", text: "원고 준비 실행", taskId: "task", createdAt: "now" }, { id: "ack", role: "assistant", text: "원고 준비 결과를 제출했습니다.", taskId: "task", createdAt: "now" }, { id: "approval", role: "user", text: "원고 v1 승인", createdAt: "now" }];
    const project = { steps: [{ id: "script", name: "원고" }], artifacts: [{ ...artifact("result", "Done"), approvedAt: "now" }], logs } as WorkflowProject;
    const tasks = [{ id: "task", kind: "step", stepId: "script" }] as WorkflowTask[];
    expect(logs.map((log) => isProductionActivity(log, project, tasks))).toEqual([true, true, true]);
    expect(logs.every((log) => log.kind === undefined)).toBe(true);
  });
  it("keeps explicit feedback and later user notes as conversation even when they resemble commands", () => {
    const first: WorkflowLog = { id: "first", role: "user", text: "원고 준비 실행", taskId: "task", createdAt: "now" };
    const note: WorkflowLog = { ...first, id: "note" };
    const project = { steps: [{ id: "script", name: "원고" }], artifacts: [], logs: [first, note] } as unknown as WorkflowProject;
    const tasks = [{ id: "task", kind: "step", stepId: "script" }] as WorkflowTask[];
    expect(isProductionActivity(note, project, tasks)).toBe(false);
    expect(isProductionActivity({ ...first, kind: "message" }, project, tasks)).toBe(false);
    expect(isProductionActivity(first, project, [{ ...tasks[0], feedback: first.text }])).toBe(false);
    expect(isProductionActivity({ ...first, kind: "activity" }, project, tasks)).toBe(true);
  });
  it("follows new server versions only while the latest-result view is unedited", () => {
    const first = artifact("v1", "First"), next = artifact("v2", "Next"), draft = resultDraftFor(first);
    expect(resultDraftDirty(draft)).toBe(false);
    expect(resolveResultDraft(draft, next)).toMatchObject({ content: "Next", versionId: "v2", baseArtifactId: "v2" });
  });
  it("preserves unsaved text and file changes when polling delivers a different result", () => {
    const first = artifact("v1", "First"), next = artifact("v2", "Server change"), draft = { ...resultDraftFor(first), content: "My draft", fileId: "my-file" };
    expect(resolveResultDraft(draft, next)).toBe(draft); expect(resultDraftDirty(draft)).toBe(true);
    expect(first.content).toBe("First");
  });
  it("keeps a historical version selected but recognizes a successfully submitted latest result", () => {
    const first = artifact("v1", "First"), second = artifact("v2", "Second"), third = artifact("v3", "Third");
    const history = resultDraftFor(first, second.id);
    expect(resolveResultDraft(history, third)).toBe(history);
    const submitted = { ...resultDraftFor(second), content: third.content };
    expect(resolveResultDraft(submitted, third).versionId).toBe(third.id);
    expect(resultDraftDirty(resolveResultDraft(submitted, third))).toBe(false);
  });
  it("separates running, review, completed and ambiguous session states", () => {
    const session: ProductionSession = { id: "session-a", projectId: "project", sourceRevision: 1, requestId: "request", name: "Episode", brief: "", revision: 1, steps: [{ id: "script", name: "Script", kind: "text", instruction: "", review: true, inputs: [] }], states: { script: { status: "review" } }, outputs: [], logs: [], artifacts: [], proposals: [], createdAt: "now", updatedAt: "now", autoRun: false };
    const task: WorkflowTask = { id: "task", projectId: "project", sessionId: "session-b", stepId: "script", requestId: "task-request", kind: "step", status: "running", createdAt: "now", updatedAt: "now" };
    expect(productionSessionStatus(session, [task]).label).toBe("검수 대기");
    expect(productionSessionStatus(session, [{ ...task, sessionId: session.id }]).label).toBe("제작 중");
    expect(productionSessionStatus({ ...session, states: { script: { status: "failed" } } }, [{ ...task, sessionId: session.id, status: "unknown" }]).label).toBe("확인 필요");
    expect(productionSessionStatus(session, [{ ...task, sessionId: session.id, status: "unknown" }]).label).toBe("검수 대기");
    expect(productionSessionStatus({ ...session, states: { script: { status: "complete" } } }, [])).toMatchObject({ label: "완료", completed: 1, total: 1 });
  });
});
