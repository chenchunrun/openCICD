import Link from "next/link";
import {
  getDashboardStats,
  getEvidenceExportBundle,
  getReleaseWorkflowBlockerIssues,
  getWorkflowIntegrityIssues,
} from "@/lib/api-client";

function formatActivityLabel(type: string) {
  return type.replaceAll("_", " ");
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

export default async function DashboardOverviewPage() {
  const [stats, auditBundle, workflowIssues, releaseWorkflowIssues] = await Promise.all([
    getDashboardStats(),
    getEvidenceExportBundle(),
    getWorkflowIntegrityIssues(),
    getReleaseWorkflowBlockerIssues(),
  ]);
  const deliveryCards = [
    { title: "Active Tasks", value: stats.activeTasks, description: "Tasks queued or awaiting completion" },
    { title: "Running Agents", value: stats.runningAgents, description: "Runs currently executing or verifying" },
    { title: "Pending Reviews", value: stats.pendingReviews, description: "Runs waiting on review or approval" },
    { title: "Evidence Records", value: stats.evidenceRecords, description: "Evidence bundles stored in the control plane" },
  ];
  const qualityCards = [
    { title: "Failed Runs", value: stats.failedRuns, description: "Runs that ended in failed state" },
    { title: "Security Blocks", value: stats.securityScanBlocks, description: "Runs blocked by secret, SAST, dependency, or license scans" },
    { title: "Scan Escalations", value: stats.scanEscalatedApprovalBlocks, description: "Release candidates forced into human approval after blocking scan findings" },
    { title: "Workflow Drift", value: stats.workflowDriftedCount, description: "Generated GitHub workflows that differ from the connected local checkout" },
    { title: "Workflow Missing", value: stats.workflowMissingCount, description: "Expected GitHub workflows that are absent from connected local checkouts" },
    { title: "Runs With Repairs", value: stats.runsWithRepairs, description: "Runs that entered at least one repair loop" },
    { title: "Escalated Repairs", value: stats.escalatedRepairs, description: "Repair loops that escalated instead of auto-resolving" },
    { title: "Approval Pending", value: stats.approvalPendingEvidence, description: "Evidence records still waiting on human approval" },
    { title: "Brokered Blocks", value: stats.brokeredApprovalBlocks, description: "Release candidates blocked by brokered risk or approval rules" },
  ];
  const auditCards = [
    { title: "Scan Findings", value: stats.totalScanFindings, description: "Total structured secret, SAST, dependency, and license findings captured in evidence" },
    { title: "Approvals", value: stats.governanceApprovals, description: "Human approval actions recorded in the evidence trail" },
    { title: "Rejections", value: stats.governanceRejections, description: "Human rejection actions recorded in the evidence trail" },
    { title: "Stops", value: stats.governanceStops, description: "Operator stop actions recorded in the evidence trail" },
    { title: "PR Deliveries", value: stats.prDeliveries, description: "GitHub pull requests created from successful runs" },
    { title: "Review Deliveries", value: stats.reviewDeliveries, description: "GitHub review submissions delivered from the control plane" },
    { title: "Release Dispatches", value: stats.releaseDispatches, description: "GitHub release workflows dispatched through the release gate" },
    { title: "Workflow-Clean Repos", value: stats.workflowInstalledRepos, description: "Connected repositories whose generated workflow pack fully matches the local checkout" },
    { title: "Git Worktree", value: stats.gitWorktreeEvidence, description: "Evidence records prepared with true git worktrees" },
    { title: "Synthetic Git", value: stats.syntheticGitEvidence, description: "Evidence records prepared with synthetic git sandboxes" },
  ];
  const alerts = [
    stats.failedRuns > 0 ? `${stats.failedRuns} failed run(s) need investigation.` : null,
    stats.securityScanBlocks > 0 ? `${stats.securityScanBlocks} run(s) are blocked by security, supply-chain, or license scans.` : null,
    stats.scanEscalatedApprovalBlocks > 0 ? `${stats.scanEscalatedApprovalBlocks} release candidate(s) were forced into human approval after scan findings.` : null,
    stats.workflowDriftedCount > 0 ? `${stats.workflowDriftedCount} generated workflow file(s) have drifted from the local checkout.` : null,
    stats.workflowMissingCount > 0 ? `${stats.workflowMissingCount} expected workflow file(s) are missing from connected local checkouts.` : null,
    stats.workflowUnknownCount > 0 ? `${stats.workflowUnknownCount} workflow file(s) could not be locally verified because no checkout is connected.` : null,
    stats.escalatedRepairs > 0 ? `${stats.escalatedRepairs} repair loop(s) escalated to human review.` : null,
    stats.approvalPendingEvidence > 0 ? `${stats.approvalPendingEvidence} evidence record(s) are still waiting for approval.` : null,
    stats.brokeredApprovalBlocks > 0 ? `${stats.brokeredApprovalBlocks} task(s) are blocked by brokered approval boundaries.` : null,
    stats.governanceRejections > 0 ? `${stats.governanceRejections} rejection action(s) were recorded in the governance trail.` : null,
    stats.governanceStops > 0 ? `${stats.governanceStops} operator stop action(s) were recorded in the governance trail.` : null,
  ].filter((value): value is string => Boolean(value));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Overview</h1>
        <p className="mt-1 text-sm text-gray-400">
          Monitor your AI-powered CI/CD pipeline at a glance.
        </p>
      </div>

      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Delivery Flow</h2>
        </div>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-5">
          {deliveryCards.map((card) => (
            <div
              key={card.title}
              className="rounded-lg border border-gray-800 bg-gray-900 p-6"
            >
              <p className="text-sm font-medium text-gray-400">{card.title}</p>
              <p className="mt-2 text-3xl font-bold text-white">{card.value}</p>
              <p className="mt-1 text-xs text-gray-500">{card.description}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Quality Signals</h2>
        </div>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-9">
          {qualityCards.map((card) => (
            <div
              key={card.title}
              className="rounded-lg border border-gray-800 bg-gray-900 p-6"
            >
              <p className="text-sm font-medium text-gray-400">{card.title}</p>
              <p
                className={
                  card.title === "Failed Runs" ||
                  card.title === "Escalated Repairs" ||
                  card.title === "Security Blocks" ||
                  card.title === "Scan Escalations" ||
                  card.title === "Workflow Missing"
                    ? "mt-2 text-3xl font-bold text-red-300"
                    : card.title === "Workflow Drift"
                      ? "mt-2 text-3xl font-bold text-amber-300"
                    : "mt-2 text-3xl font-bold text-white"
                }
              >
                {card.value}
              </p>
              <p className="mt-1 text-xs text-gray-500">{card.description}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Audit & Governance</h2>
        </div>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {auditCards.map((card) => (
            <div
              key={card.title}
              className="rounded-lg border border-gray-800 bg-gray-900 p-6"
            >
              <p className="text-sm font-medium text-gray-400">{card.title}</p>
              <p
                className={
                  card.title === "Rejections" || card.title === "Stops"
                    ? "mt-2 text-3xl font-bold text-amber-300"
                    : card.title === "Scan Findings"
                      ? "mt-2 text-3xl font-bold text-rose-300"
                      : "mt-2 text-3xl font-bold text-white"
                }
              >
                {card.value}
              </p>
              <p className="mt-1 text-xs text-gray-500">{card.description}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-gray-800 bg-gray-900 p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Attention Needed</h2>
        <div className="mt-4 space-y-3">
          {alerts.length > 0 ? (
            alerts.map((alert) => (
              <div
                key={alert}
                className="rounded-md border border-amber-900 bg-amber-950/30 px-4 py-3 text-sm text-amber-100"
              >
                {alert}
              </div>
            ))
          ) : (
            <div className="rounded-md border border-emerald-900 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-100">
              No immediate delivery or quality issues detected.
            </div>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-gray-800 bg-gray-900 p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Workflow Integrity</h2>
            <p className="mt-1 text-sm text-gray-500">
              Repositories whose generated workflow pack is missing, drifted, or cannot be locally verified.
            </p>
          </div>
          <Link
            href="/dashboard/repos"
            className="rounded-md border border-gray-700 px-3 py-2 text-xs font-medium text-gray-200 transition hover:border-gray-600 hover:bg-gray-950"
          >
            Open Repositories
          </Link>
        </div>
        <div className="mt-4 space-y-3">
          {workflowIssues.length > 0 ? (
            workflowIssues.slice(0, 6).map((issue) => (
              <div
                key={`${issue.repoId}-${issue.status}-${issue.workflowNames.join(",")}`}
                className="rounded-md border border-gray-800 bg-gray-950 p-4"
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-500">{issue.status}</p>
                    <p className="mt-2 text-sm font-medium text-white">{issue.repo}</p>
                    <p className="mt-1 text-xs text-gray-400">
                      Workflows: {issue.workflowNames.join(", ")}
                    </p>
                    <p className="mt-2 text-sm text-gray-300">{issue.detail}</p>
                    <p className="mt-1 text-xs text-gray-500">
                      {issue.localPath ? `Local checkout: ${issue.localPath}` : "No local checkout connected"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 lg:justify-end">
                    <Link
                      href={`/dashboard/repos?repoId=${encodeURIComponent(issue.repoId)}`}
                      className="rounded-md border border-gray-700 px-3 py-2 text-xs font-medium text-gray-200 transition hover:border-gray-600 hover:bg-gray-900"
                    >
                      Open Workflow Pack
                    </Link>
                    <Link
                      href="/dashboard/release"
                      className="rounded-md border border-sky-800 px-3 py-2 text-xs font-medium text-sky-200 transition hover:border-sky-700 hover:bg-sky-950/30"
                    >
                      Open Release
                    </Link>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-md border border-emerald-900 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-100">
              All connected repositories currently match their generated workflow pack.
            </div>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-gray-800 bg-gray-900 p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Release Workflow Blockers</h2>
            <p className="mt-1 text-sm text-gray-500">
              Release candidates currently blocked because the required GitHub release workflow is missing, drifted, or cannot be verified.
            </p>
          </div>
          <Link
            href="/dashboard/release"
            className="rounded-md border border-gray-700 px-3 py-2 text-xs font-medium text-gray-200 transition hover:border-gray-600 hover:bg-gray-950"
          >
            Open Release
          </Link>
        </div>
        <div className="mt-4 space-y-3">
          {releaseWorkflowIssues.length > 0 ? (
            releaseWorkflowIssues.slice(0, 6).map((issue) => (
              <div
                key={`${issue.taskId}-${issue.status}`}
                className="rounded-md border border-gray-800 bg-gray-950 p-4"
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-500">{issue.status}</p>
                    <p className="mt-2 text-sm font-medium text-white">{issue.goal}</p>
                    <p className="mt-1 text-xs text-gray-400">
                      {issue.repo ?? "Unknown repo"} · {issue.workflowPath}
                    </p>
                    <p className="mt-2 text-sm text-gray-300">{issue.detail}</p>
                    <p className="mt-1 text-xs text-gray-500">
                      {issue.blockers.length > 0 ? issue.blockers.join(" · ") : "Verification warning only"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 lg:justify-end">
                    <Link
                      href="/dashboard/release"
                      className="rounded-md border border-sky-800 px-3 py-2 text-xs font-medium text-sky-200 transition hover:border-sky-700 hover:bg-sky-950/30"
                    >
                      Open Release Queue
                    </Link>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-md border border-emerald-900 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-100">
              No active release candidates are blocked by workflow installation issues.
            </div>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-gray-800 bg-gray-900 p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Recent Audit Activity</h2>
            <p className="mt-1 text-sm text-gray-500">
              Latest governance and delivery actions captured in evidence.
            </p>
          </div>
          <Link
            href="/dashboard/audit-export"
            className="rounded-md border border-gray-700 px-3 py-2 text-xs font-medium text-gray-200 transition hover:border-gray-600 hover:bg-gray-950"
          >
            Open Audit Export
          </Link>
        </div>
        <div className="mt-4 space-y-3">
          {auditBundle.activity.length > 0 ? (
            auditBundle.activity.slice(0, 6).map((activity, index) => (
              <div
                key={`${activity.evidenceId}-${activity.type}-${activity.timestamp ?? index}`}
                className="rounded-md border border-gray-800 bg-gray-950 p-4"
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-500">{formatActivityLabel(activity.type)}</p>
                    <p className="mt-2 text-sm font-medium text-white">{activity.repo ?? "Unknown repo"}</p>
                    <p className="mt-1 text-xs text-gray-400">
                      Actor: {formatActivityActor(activity.actor)}
                      {activity.runId ? ` · Run ${activity.runId.slice(0, 8)}` : ""}
                    </p>
                  </div>
                  <div className="text-left lg:text-right">
                    <p className="text-xs text-gray-500">
                      {activity.timestamp ? new Date(activity.timestamp).toLocaleString() : "No timestamp"}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2 lg:justify-end">
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
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-md border border-dashed border-gray-800 bg-gray-950 p-4 text-sm text-gray-500">
              No governance or delivery actions have been recorded yet.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
