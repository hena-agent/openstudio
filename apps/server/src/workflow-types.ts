import type { Asset, Model, ProviderId } from "@openstudio/shared/types";
import type { AgentBinding, PreparationArtifact, ProductionSession, WorkflowOutput, WorkflowProject, WorkflowStep, WorkflowTask } from "@openstudio/shared/workflow";

export type AgentResult =
  | { type: "proposal"; name: string; summary: string; steps: WorkflowStep[]; outputs: WorkflowOutput[]; scope: "single-video" }
  | { type: "artifact"; content: string }
  | { type: "question"; question: string };
export type StoredWorkflowTask = WorkflowTask & {
  agent: AgentBinding; provider: ProviderId; providerBaseURL: string; modelSnapshot: Model;
  snapshot: Pick<WorkflowProject, "name" | "brief" | "revision" | "steps" | "outputs"> & {
    step?: WorkflowStep; inputs: PreparationArtifact[]; previous?: PreparationArtifact; question?: string; feedbackHistory?: string[];
    settings?: WorkflowProject["settings"]; video?: WorkflowProject["video"];
    referenceImages?: (Asset & { purpose: string })[];
    conversation?: { role: "user" | "assistant"; text: string }[];
    guidance?: string;
  };
  definitionHash?: string; inputArtifacts: Record<string, string>;
  result?: AgentResult; runId?: string; requestStartedAt?: string;
  notes: string[]; deliveredNotes: number;
};
export type SessionModel = { binding: AgentBinding; provider: ProviderId; providerBaseURL: string; modelSnapshot: Model };
export type StoredProductionSession = ProductionSession & { runtimeModels: SessionModel[] };
