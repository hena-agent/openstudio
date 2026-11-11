import { stepStatusNames, type StepStatus } from "@openstudio/shared/workflow";
import { Badge } from "@/components/ui/badge";
export function StatusBadge({ status = "idle" }: { status?: StepStatus }) { return <Badge data-status={status} variant={status === "complete" ? "success" : ["review", "needs_input", "stale"].includes(status) ? "warning" : status === "failed" ? "destructive" : "outline"}>{stepStatusNames[status]}</Badge>; }
