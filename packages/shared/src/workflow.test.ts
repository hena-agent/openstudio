import { describe, expect, it } from "vitest";
import { inputOrderIssues, moveWorkflowStep, precedingSteps, readySteps, workflowIssues, type ProductionSession, type WorkflowStep } from "./workflow";

const step = (id: string, inputs: string[] = []): WorkflowStep => ({ id, name: id, kind: "text", instruction: "", inputs, review: true });

describe("ordered workflow inputs", () => {
  it("offers only preceding steps, including no candidates for the first or an unknown step", () => {
    const steps = [step("a"), step("b"), step("c"), step("d")];
    expect(precedingSteps(steps, "a")).toEqual([]);
    expect(precedingSteps(steps, "c").map((item) => item.id)).toEqual(["a", "b"]);
    expect(precedingSteps(steps, "missing")).toEqual([]);
  });
  it("accepts parallel branches and reports future, self, missing and cyclic references distinctly", () => {
    expect(workflowIssues({ steps: [step("a"), step("b", ["a"]), step("c", ["a"]), step("d", ["b", "c"])], outputs: [] })).toEqual([]);
    expect(inputOrderIssues([step("a", ["b"]), step("b")])).toMatchObject([{ stepId: "a", inputId: "b", code: "input_order" }]);
    const issues = workflowIssues({ steps: [step("a", ["a", "missing"])], outputs: [] });
    expect(issues.some((issue) => issue.code === "input_order")).toBe(true);
    expect(issues.some((issue) => issue.message.includes("없는 입력"))).toBe(true);
    expect(issues.some((issue) => issue.message.includes("순환"))).toBe(true);
  });
  it("blocks dependency-inverting moves, permits independent moves, and allows repairing old order errors", () => {
    const steps = [step("a"), step("b", ["a"]), step("c", ["a"])];
    expect(moveWorkflowStep(steps, "b", -1).reason).toContain("입력 연결");
    expect(moveWorkflowStep(steps, "a", 1).reason).toContain("입력 연결");
    expect(moveWorkflowStep(steps, "b", 1).steps.map((item) => item.id)).toEqual(["a", "c", "b"]);
    expect(steps.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(inputOrderIssues(moveWorkflowStep([step("b", ["a"]), step("a")], "a", -1).steps)).toEqual([]);
  });
  it("preserves pre-rule session execution semantics while enforcing the order in new sessions", () => {
    const session: ProductionSession = { id: "session", projectId: "project", sourceRevision: 1, requestId: "request", name: "Old production", brief: "", revision: 1, steps: [step("b", ["a"]), step("a")], outputs: [], states: {}, artifacts: [], proposals: [], logs: [], autoRun: false, createdAt: "now", updatedAt: "now" };
    expect(workflowIssues(session)).toEqual([]); expect(readySteps(session).map((item) => item.id)).toEqual(["a"]);
    expect(workflowIssues({ ...session, inputOrderVersion: 1 }).some((issue) => issue.code === "input_order")).toBe(true);
    expect(readySteps({ ...session, inputOrderVersion: 1 } as ProductionSession)).toEqual([]);
  });
});
