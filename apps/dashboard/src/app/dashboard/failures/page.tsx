import Link from "next/link";
import { getEvidences, getReleaseGate, getRuns, getTasks } from "@/lib/api-client";

function getErrorMessage(run: Awaited<ReturnType<typeof getRuns>>[number]) {
  const errorEvent = run.events?.find((event) => event.type === "error");
  if (!errorEvent) {
    return null;
  }

  return typeof errorEvent.data?.message === "string"
    ? errorEvent.data.message
    : JSON.stringify(errorEvent.data);
}

function getSecurityScanSummary(run: Awaited<ReturnType<typeof getRuns>>[number]) {
  const verificationEvent = run.events?.find((event) => event.type === "verification_completed");
  if (!verificationEvent || !verificationEvent.data || typeof verificationEvent.data !== "object") {
    return null;
  }

  const data = verificationEvent.data as Record<string, unknown>;
  const checks =
    data.checks && typeof data.checks === "object"
      ? (data.checks as Record<string, unknown>)
      : {};
  const secretScan = checks.secret_scan === "failed";
  const sastScan = checks.sast_scan === "failed";
  const dependencyScan = checks.dependency_scan === "failed";
  const licenseScan = checks.license_scan === "failed";

  if (!secretScan && !sastScan && !dependencyScan && !licenseScan) {
    return null;
  }

  return {
    secretScan,
    sastScan,
    dependencyScan,
    licenseScan,
    findings:
      (Array.isArray(data.secretScanFindings) ? data.secretScanFindings.length : 0) +
      (Array.isArray(data.sastScanFindings) ? data.sastScanFindings.length : 0) +
      (Array.isArray(data.dependencyScanFindings) ? data.dependencyScanFindings.length : 0) +
      (Array.isArray(data.licenseScanFindings) ? data.licenseScanFindings.length : 0),
  };
}

export default async function DashboardFailuresPage() {
  const [runs, evidences, tasks] = await Promise.all([getRuns(), getEvidences(), getTasks()]);
  const failedRuns = runs.filter((run) => run.status === "failed");
  const escalatedRuns = runs.filter((run) => Boolean(run.repairs?.[0]?.escalationReason));
  const securityBlockedRuns = runs.filter((run) => Boolean(getSecurityScanSummary(run)));
  const pendingApprovals = evidences.filter((evidence) =>
    evidence.reviewSection?.humanReview === "required" ||
    evidence.reviewSection?.codeOwnerApproval === "pending",
  );
  const brokeredApprovalBlocks = (
    await Promise.all(
      tasks
        .filter((task) => ["completed", "failed", "stopped", "in_progress"].includes(task.status))
        .slice(0, 8)
        .map(async (task) => {
          const gate = await getReleaseGate(task.id);
          const humanApprovalBlocked =
            gate.blockers.includes("Human approval required") ||
            gate.blockers.includes("Human approval required after blocking scan findings");
          const scanEscalatedApproval = gate.blockers.includes(
            "Human approval required after blocking scan findings",
          );
          const brokeredRisk = gate.brokeredContext?.riskLevel ?? "unknown";
          const brokeredApprovalRequired =
            gate.brokeredContext?.trustBoundaries?.requiresHumanApproval === true;

          if (!humanApprovalBlocked || (!brokeredApprovalRequired && brokeredRisk === "low")) {
            return null;
          }

          return {
            task,
            gate,
            scanEscalatedApproval,
          };
        }),
    )
  ).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Failures And Escalations</h1>
        <p className="mt-1 text-sm text-gray-400">
          Focused queue for runs that failed, repairs that escalated, and evidence still waiting on approval.
        </p>
      </div>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Failed Runs</h2>
          <span className="text-sm text-gray-500">{failedRuns.length}</span>
        </div>
        <div className="space-y-3">
          {failedRuns.length > 0 ? (
            failedRuns.map((run) => (
              <Link
                key={run.id}
                href={`/dashboard/runs/${run.id}`}
                className="block rounded-lg border border-red-900 bg-red-950/20 p-4 transition hover:border-red-800"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm text-red-200">Run {run.id.slice(0, 8)}</p>
                    <p className="mt-1 text-base font-semibold text-white">{run.agentName}</p>
                    <p className="mt-2 text-sm text-gray-300">Task: {run.taskId}</p>
                    {getErrorMessage(run) ? (
                      <p className="mt-3 line-clamp-2 text-sm text-red-200">{getErrorMessage(run)}</p>
                    ) : null}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-medium text-red-300">{run.status}</p>
                    <p className="mt-2 text-xs text-gray-500">
                      {run.finishedAt ? new Date(run.finishedAt).toLocaleString() : "No finish time"}
                    </p>
                  </div>
                </div>
              </Link>
            ))
          ) : (
            <div className="rounded-lg border border-dashed border-gray-800 bg-gray-900/60 p-4 text-sm text-gray-500">
              No failed runs.
            </div>
          )}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Escalated Repairs</h2>
          <span className="text-sm text-gray-500">{escalatedRuns.length}</span>
        </div>
        <div className="space-y-3">
          {escalatedRuns.length > 0 ? (
            escalatedRuns.map((run) => {
              const repair = run.repairs?.[0];
              return (
                <Link
                  key={run.id}
                  href={`/dashboard/runs/${run.id}`}
                  className="block rounded-lg border border-amber-900 bg-amber-950/20 p-4 transition hover:border-amber-800"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm text-amber-200">Run {run.id.slice(0, 8)}</p>
                      <p className="mt-1 text-base font-semibold text-white">
                        Latest repair: {repair?.failureType ?? "unknown"}
                      </p>
                      <p className="mt-2 text-sm text-gray-300">
                        Repair loops: {run._count?.repairs ?? run.repairs?.length ?? 0}
                      </p>
                      {repair?.escalationReason ? (
                        <p className="mt-3 line-clamp-2 text-sm text-amber-100">{repair.escalationReason}</p>
                      ) : null}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-medium text-amber-300">{run.status}</p>
                      <p className="mt-2 text-xs text-gray-500">
                        {run.finishedAt ? new Date(run.finishedAt).toLocaleString() : "Still open"}
                      </p>
                    </div>
                  </div>
                </Link>
              );
            })
          ) : (
            <div className="rounded-lg border border-dashed border-gray-800 bg-gray-900/60 p-4 text-sm text-gray-500">
              No escalated repairs.
            </div>
          )}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Security Scan Blocks</h2>
          <span className="text-sm text-gray-500">{securityBlockedRuns.length}</span>
        </div>
        <div className="space-y-3">
          {securityBlockedRuns.length > 0 ? (
            securityBlockedRuns.map((run) => {
              const summary = getSecurityScanSummary(run);
              return (
                <Link
                  key={run.id}
                  href={`/dashboard/runs/${run.id}`}
                  className="block rounded-lg border border-rose-900 bg-rose-950/20 p-4 transition hover:border-rose-800"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm text-rose-200">Run {run.id.slice(0, 8)}</p>
                      <p className="mt-1 text-base font-semibold text-white">{run.agentName}</p>
                      <p className="mt-2 text-sm text-gray-300">Task: {run.taskId}</p>
                      <p className="mt-3 text-sm text-rose-100">
                        {summary?.secretScan ? "secret_scan blocked" : null}
                        {summary?.secretScan && summary?.sastScan ? " · " : null}
                        {summary?.sastScan ? "sast_scan blocked" : null}
                        {(summary?.secretScan || summary?.sastScan) && summary?.dependencyScan ? " · " : null}
                        {summary?.dependencyScan ? "dependency_scan blocked" : null}
                        {(summary?.secretScan || summary?.sastScan || summary?.dependencyScan) && summary?.licenseScan
                          ? " · "
                          : null}
                        {summary?.licenseScan ? "license_scan blocked" : null}
                        {typeof summary?.findings === "number" ? ` · findings: ${summary.findings}` : ""}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-medium text-rose-300">{run.status}</p>
                      <p className="mt-2 text-xs text-gray-500">
                        {run.finishedAt ? new Date(run.finishedAt).toLocaleString() : "Still open"}
                      </p>
                    </div>
                  </div>
                </Link>
              );
            })
          ) : (
            <div className="rounded-lg border border-dashed border-gray-800 bg-gray-900/60 p-4 text-sm text-gray-500">
              No security scan blocks detected.
            </div>
          )}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Approval Pending Evidence</h2>
          <span className="text-sm text-gray-500">{pendingApprovals.length}</span>
        </div>
        <div className="space-y-3">
          {pendingApprovals.length > 0 ? (
            pendingApprovals.map((evidence) => (
              <Link
                key={evidence.id}
                href={evidence.runId ? `/dashboard/runs/${evidence.runId}` : "/dashboard/evidence"}
                className="block rounded-lg border border-sky-900 bg-sky-950/20 p-4 transition hover:border-sky-800"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm text-sky-200">Evidence {evidence.id.slice(0, 8)}</p>
                    <p className="mt-1 text-base font-semibold text-white">{evidence.repo ?? "Unknown repo"}</p>
                    <p className="mt-2 text-sm text-gray-300">
                      Human review: {evidence.reviewSection?.humanReview ?? "unknown"} | Code owner:{" "}
                      {evidence.reviewSection?.codeOwnerApproval ?? "unknown"}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-medium text-sky-300">{evidence.status}</p>
                    <p className="mt-2 text-xs text-gray-500">
                      {new Date(evidence.createdAt).toLocaleString()}
                    </p>
                  </div>
                </div>
              </Link>
            ))
          ) : (
            <div className="rounded-lg border border-dashed border-gray-800 bg-gray-900/60 p-4 text-sm text-gray-500">
              No evidence records are waiting on approval.
            </div>
          )}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Brokered Approval Blocks</h2>
          <span className="text-sm text-gray-500">{brokeredApprovalBlocks.length}</span>
        </div>
        <div className="space-y-3">
          {brokeredApprovalBlocks.length > 0 ? (
            brokeredApprovalBlocks.map(({ task, gate, scanEscalatedApproval }) => (
              <Link
                key={task.id}
                href={gate.latestRunId ? `/dashboard/runs/${gate.latestRunId}` : "/dashboard/release"}
                className="block rounded-lg border border-violet-900 bg-violet-950/20 p-4 transition hover:border-violet-800"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm text-violet-200">Task {task.id.slice(0, 8)}</p>
                    <p className="mt-1 text-base font-semibold text-white">{task.goal}</p>
                    <p className="mt-2 text-sm text-gray-300">
                      Brokered risk: {gate.brokeredContext?.riskLevel ?? "unknown"} | Human approval:{" "}
                      {scanEscalatedApproval
                        ? "required after scan findings"
                        : gate.brokeredContext?.trustBoundaries?.requiresHumanApproval
                          ? "required"
                          : "not required"}
                    </p>
                    <p className="mt-3 line-clamp-2 text-sm text-violet-100">
                      {gate.blockers.join(" · ")}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-medium text-violet-300">
                      {gate.canRelease ? "ready" : "blocked"}
                    </p>
                    <p className="mt-2 text-xs text-gray-500">Latest run: {gate.latestRunId ?? "none"}</p>
                  </div>
                </div>
              </Link>
            ))
          ) : (
            <div className="rounded-lg border border-dashed border-gray-800 bg-gray-900/60 p-4 text-sm text-gray-500">
              No brokered approval blocks detected.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
