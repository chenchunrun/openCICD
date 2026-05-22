import { revalidatePath } from "next/cache";
import Link from "next/link";
import { redirect } from "next/navigation";
import { rejectTask, getEvidences, getEvidenceExportBundle, getReleaseGate, getRuns, getTasks, canPerformRole } from "@/lib/api-client";
import { rethrowIfRedirectError } from "@/lib/server-action";

async function rejectTaskAction(formData: FormData) {
  "use server";

  try {
    const taskId = formData.get("taskId");
    const reason = formData.get("reason");
    if (typeof taskId !== "string" || taskId.length === 0) {
      throw new Error("taskId is required");
    }
    if (typeof reason !== "string" || reason.trim().length === 0) {
      throw new Error("Rejection reason is required");
    }

    await rejectTask(taskId, reason.trim());
    revalidatePath("/dashboard/failures");
    revalidatePath("/dashboard/release");
    redirect(`/dashboard/failures?notice=${encodeURIComponent(`task_rejected:${taskId}`)}`);
  } catch (error) {
    rethrowIfRedirectError(error);
    const message = error instanceof Error ? error.message : "Task rejection failed";
    redirect(`/dashboard/failures?error=${encodeURIComponent(message)}`);
  }
}

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

function isGovernanceStopped(run: Awaited<ReturnType<typeof getRuns>>[number]) {
  return run.events?.some((event) => event.type === "run_stopped") ?? false;
}

function formatActivityActor(actor: Record<string, unknown> | null) {
  if (!actor) {
    return "Unknown actor";
  }

  const name = typeof actor.name === "string" ? actor.name : null;
  const role = typeof actor.role === "string" ? actor.role : null;
  const source = typeof actor.source === "string" ? actor.source : null;
  const parts = [name, role, source].filter(Boolean);
  return parts.length > 0 ? parts.join(" / ") : "Unknown actor";
}

function formatActivityLabel(type: string) {
  return type.replaceAll("_", " ");
}

export default async function DashboardFailuresPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const noticeParam = typeof resolvedSearchParams?.notice === "string" ? resolvedSearchParams.notice : undefined;
  const errorParam = typeof resolvedSearchParams?.error === "string" ? resolvedSearchParams.error : undefined;
  const canReject = canPerformRole("releaser");
  const [runs, evidences, tasks, governanceActivityBundle] = await Promise.all([
    getRuns(),
    getEvidences(),
    getTasks(),
    getEvidenceExportBundle({ actionTypes: ["task_rejected", "run_stopped"] }),
  ]);
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
  const governanceBlocks = (
    await Promise.all(
      tasks
        .filter((task) => ["approved", "rejected", "stopped", "failed", "completed", "in_progress"].includes(task.status))
        .slice(0, 12)
        .map(async (task) => {
          const relatedRun = runs.find((run) => run.taskId === task.id);
          const gate = ["completed", "failed", "stopped", "in_progress"].includes(task.status)
            ? await getReleaseGate(task.id)
            : null;
          const approvalBlocked = gate?.blockers.some((blocker) => blocker.includes("Human approval required")) ?? false;
          const rejected = task.status === "rejected";
          const stopped = relatedRun ? isGovernanceStopped(relatedRun) : false;

          if (!approvalBlocked && !rejected && !stopped) {
            return null;
          }

          return {
            task,
            run: relatedRun ?? null,
            gate,
            rejected,
            stopped,
            approvalBlocked,
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

      {noticeParam ? (
        <div className="rounded-lg border border-emerald-800 bg-emerald-950/50 px-4 py-3 text-sm text-emerald-200">
          {noticeParam.startsWith("task_rejected:")
            ? `Rejection recorded for ${noticeParam.split(":")[1] ?? "task"}.`
            : noticeParam}
        </div>
      ) : null}

      {errorParam ? (
        <div className="rounded-lg border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-200">
          {errorParam}
        </div>
      ) : null}

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Governance Blocks</h2>
          <span className="text-sm text-gray-500">{governanceBlocks.length}</span>
        </div>
        <div className="space-y-3">
          {governanceBlocks.length > 0 ? (
            governanceBlocks.map(({ task, run, gate, rejected, stopped, approvalBlocked }) => (
              <div
                key={task.id}
                className="rounded-lg border border-slate-700 bg-slate-950/40 p-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm text-slate-300">Task {task.id.slice(0, 8)}</p>
                    <p className="mt-1 text-base font-semibold text-white">{task.goal}</p>
                    <p className="mt-2 text-sm text-gray-300">
                      {rejected ? "Rejected by human approval flow" : null}
                      {rejected && (approvalBlocked || stopped) ? " · " : null}
                      {approvalBlocked ? "Waiting on approval boundary" : null}
                      {approvalBlocked && stopped ? " · " : null}
                      {stopped ? "Stopped by operator" : null}
                    </p>
                    {gate?.blockers?.length ? (
                      <p className="mt-3 line-clamp-2 text-sm text-slate-200">
                        {gate.blockers.join(" · ")}
                      </p>
                    ) : null}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-medium text-slate-300">{task.status}</p>
                    <p className="mt-2 text-xs text-gray-500">Run: {run?.id?.slice(0, 8) ?? "none"}</p>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-3">
                  <Link
                    href={run ? `/dashboard/runs/${run.id}` : "/dashboard/release"}
                    className="rounded-md border border-gray-700 px-3 py-2 text-xs font-medium text-gray-200 transition hover:border-gray-600 hover:bg-gray-900"
                  >
                    {run ? "Open Run" : "Open Release View"}
                  </Link>
                  <form action={rejectTaskAction} className="flex items-center gap-2">
                    <input type="hidden" name="taskId" value={task.id} />
                    <input
                      type="text"
                      name="reason"
                      placeholder="Rejection reason"
                      className="w-44 rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-100 placeholder:text-gray-500"
                    />
                    <button
                      type="submit"
                      disabled={!canReject || rejected}
                      className={
                        canReject && !rejected
                          ? "rounded-md border border-amber-800 px-3 py-2 text-xs font-medium text-amber-200 transition hover:border-amber-700 hover:bg-amber-950/30"
                          : "rounded-md border border-gray-800 px-3 py-2 text-xs font-medium text-gray-500"
                      }
                    >
                      {rejected ? "Task Rejected" : canReject ? "Reject Task" : "Releaser Role Required"}
                    </button>
                  </form>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-lg border border-dashed border-gray-800 bg-gray-900/60 p-4 text-sm text-gray-500">
              No governance blocks detected.
            </div>
          )}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Recent Governance Actions</h2>
          <span className="text-sm text-gray-500">{governanceActivityBundle.activity.length}</span>
        </div>
        <div className="space-y-3">
          {governanceActivityBundle.activity.length > 0 ? (
            governanceActivityBundle.activity.slice(0, 8).map((activity, index) => (
              <div
                key={`${activity.evidenceId}-${activity.type}-${activity.timestamp ?? index}`}
                className="rounded-lg border border-slate-700 bg-slate-950/40 p-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm text-slate-300">{formatActivityLabel(activity.type)}</p>
                    <p className="mt-1 text-base font-semibold text-white">{activity.repo ?? "Unknown repo"}</p>
                    <p className="mt-2 text-sm text-gray-300">
                      Actor: {formatActivityActor(activity.actor)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs text-gray-500">
                      {activity.timestamp ? new Date(activity.timestamp).toLocaleString() : "No timestamp"}
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-3">
                  {activity.runId ? (
                    <Link
                      href={`/dashboard/runs/${activity.runId}`}
                      className="rounded-md border border-gray-700 px-3 py-2 text-xs font-medium text-gray-200 transition hover:border-gray-600 hover:bg-gray-900"
                    >
                      Open Run
                    </Link>
                  ) : null}
                  {activity.targetUrl ? (
                    <Link
                      href={activity.targetUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-md border border-sky-800 px-3 py-2 text-xs font-medium text-sky-200 transition hover:border-sky-700 hover:bg-sky-950/30"
                    >
                      Open Target
                    </Link>
                  ) : null}
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-lg border border-dashed border-gray-800 bg-gray-900/60 p-4 text-sm text-gray-500">
              No governance rejections or stop actions recorded.
            </div>
          )}
        </div>
      </section>

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
