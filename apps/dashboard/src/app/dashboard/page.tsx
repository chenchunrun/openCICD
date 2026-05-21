import { getDashboardStats } from "@/lib/api-client";

export default async function DashboardOverviewPage() {
  const stats = await getDashboardStats();
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
    { title: "Runs With Repairs", value: stats.runsWithRepairs, description: "Runs that entered at least one repair loop" },
    { title: "Escalated Repairs", value: stats.escalatedRepairs, description: "Repair loops that escalated instead of auto-resolving" },
    { title: "Approval Pending", value: stats.approvalPendingEvidence, description: "Evidence records still waiting on human approval" },
    { title: "Brokered Blocks", value: stats.brokeredApprovalBlocks, description: "Release candidates blocked by brokered risk or approval rules" },
  ];
  const alerts = [
    stats.failedRuns > 0 ? `${stats.failedRuns} failed run(s) need investigation.` : null,
    stats.securityScanBlocks > 0 ? `${stats.securityScanBlocks} run(s) are blocked by security, supply-chain, or license scans.` : null,
    stats.scanEscalatedApprovalBlocks > 0 ? `${stats.scanEscalatedApprovalBlocks} release candidate(s) were forced into human approval after scan findings.` : null,
    stats.escalatedRepairs > 0 ? `${stats.escalatedRepairs} repair loop(s) escalated to human review.` : null,
    stats.approvalPendingEvidence > 0 ? `${stats.approvalPendingEvidence} evidence record(s) are still waiting for approval.` : null,
    stats.brokeredApprovalBlocks > 0 ? `${stats.brokeredApprovalBlocks} task(s) are blocked by brokered approval boundaries.` : null,
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
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7">
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
                  card.title === "Scan Escalations"
                    ? "mt-2 text-3xl font-bold text-red-300"
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
    </div>
  );
}
