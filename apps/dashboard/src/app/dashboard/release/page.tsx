import Link from "next/link";
import { getReleaseGate, getReleasePlan, getTasks } from "@/lib/api-client";

function formatCheckName(name: string) {
  return name.replaceAll("_", " ");
}

function isScanEscalatedApproval(gate: Awaited<ReturnType<typeof getReleaseGate>>) {
  return gate.blockers.includes("Human approval required after blocking scan findings");
}

function extractReleaseNotesSection(notes: string, heading: string) {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`### ${escapedHeading}\\n([\\s\\S]*?)(?:\\n### |$)`);
  const match = notes.match(pattern);
  return match?.[1]?.trim() ?? "";
}

export default async function DashboardReleasePage() {
  const tasks = await getTasks();
  const candidateTasks = tasks
    .filter((task) => ["completed", "failed", "stopped", "in_progress"].includes(task.status))
    .slice(0, 8);

  const releaseItems = await Promise.all(
    candidateTasks.map(async (task) => {
      const [gate, plan] = await Promise.all([
        getReleaseGate(task.id),
        getReleasePlan(task.id),
      ]);

      return {
        task,
        gate,
        plan,
      };
    }),
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Release Readiness</h1>
        <p className="mt-1 text-sm text-gray-400">
          Review structured release gates, blockers, and rollback plans before promoting AI-assisted changes.
        </p>
      </div>

      {releaseItems.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-800 bg-gray-900/60 p-4 text-sm text-gray-500">
          No candidate tasks are available for release evaluation yet.
        </div>
      ) : (
        <div className="space-y-6">
          {releaseItems.map(({ task, gate, plan }) => (
            <section key={task.id} className="rounded-lg border border-gray-800 bg-gray-900">
              <div className="flex flex-col gap-3 border-b border-gray-800 px-5 py-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-gray-500">Task</p>
                  <h2 className="mt-2 text-lg font-semibold text-white">{task.goal}</h2>
                  <p className="mt-2 text-sm text-gray-400">
                    {task.id} · {plan.repo ?? "Unknown repo"}
                  </p>
                </div>
                <div className="text-left lg:text-right">
                  <p
                    className={
                      gate.canRelease
                        ? "text-sm font-semibold text-emerald-300"
                        : "text-sm font-semibold text-amber-300"
                    }
                  >
                    {gate.canRelease ? "Ready To Release" : "Blocked"}
                  </p>
                  <p className="mt-2 text-xs text-gray-500">
                    Latest run: {gate.latestRunId ?? "none"}
                  </p>
                </div>
              </div>

              <div className="grid gap-6 px-5 py-5 xl:grid-cols-[1.2fr,0.8fr]">
                <div className="space-y-5">
                  {isScanEscalatedApproval(gate) ? (
                    <div className="rounded-md border border-rose-900 bg-rose-950/30 p-4">
                      <p className="text-xs uppercase tracking-wide text-rose-300">Approval Escalation</p>
                      <p className="mt-2 text-sm text-rose-100">
                        Blocking scan findings elevated this release into a mandatory human approval path.
                      </p>
                    </div>
                  ) : null}
                  {gate.brokeredContext ? (
                    <div className="rounded-md border border-gray-800 bg-gray-950 p-4">
                      <p className="text-xs uppercase tracking-wide text-gray-500">Context Broker</p>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <div className="rounded-md border border-gray-800 bg-gray-900 p-3">
                          <p className="text-xs uppercase tracking-wide text-gray-500">Risk Level</p>
                          <p className="mt-2 text-sm font-medium text-white">
                            {gate.brokeredContext.riskLevel ?? "unknown"}
                          </p>
                        </div>
                        <div className="rounded-md border border-gray-800 bg-gray-900 p-3">
                          <p className="text-xs uppercase tracking-wide text-gray-500">Human Approval</p>
                          <p className="mt-2 text-sm font-medium text-white">
                            {isScanEscalatedApproval(gate)
                              ? "required after scan findings"
                              : gate.brokeredContext.trustBoundaries?.requiresHumanApproval
                                ? "required"
                                : "not required"}
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <div className="grid gap-3 sm:grid-cols-2">
                    {Object.entries(gate.checks).map(([name, check]) => (
                      <div key={name} className="rounded-md border border-gray-800 bg-gray-950 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-xs uppercase tracking-wide text-gray-500">{formatCheckName(name)}</p>
                          <span
                            className={
                              check.passed
                                ? "text-xs font-medium text-emerald-300"
                                : check.required
                                  ? "text-xs font-medium text-red-300"
                                  : "text-xs font-medium text-amber-300"
                            }
                          >
                            {check.passed ? "passed" : check.required ? "failed" : "warning"}
                          </span>
                        </div>
                        <p className="mt-2 text-sm text-gray-300">{check.detail}</p>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-md border border-gray-800 bg-gray-950 p-4">
                    <p className="text-xs uppercase tracking-wide text-gray-500">Release Notes</p>
                    <pre className="mt-3 whitespace-pre-wrap text-xs text-gray-300">
                      {plan.releaseNotes}
                    </pre>
                  </div>
                </div>

                <div className="space-y-5">
                  <div className="rounded-md border border-gray-800 bg-gray-950 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs uppercase tracking-wide text-gray-500">Deployment Recommendation</p>
                      <span
                        className={
                          plan.deploymentRecommendation === "ready"
                            ? "text-xs font-medium text-emerald-300"
                            : "text-xs font-medium text-red-300"
                        }
                      >
                        {plan.deploymentRecommendation}
                      </span>
                    </div>
                    <div className="mt-4 space-y-2">
                      {plan.blockers.length > 0 ? (
                        plan.blockers.map((blocker) => (
                          <div
                            key={blocker}
                            className="rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-200"
                          >
                            {blocker}
                          </div>
                        ))
                      ) : (
                        <div className="rounded-md border border-emerald-900 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-200">
                          No blocking release checks remain.
                        </div>
                      )}
                      {plan.warnings.map((warning) => (
                        <div
                          key={warning}
                          className="rounded-md border border-amber-900 bg-amber-950/30 px-3 py-2 text-sm text-amber-200"
                        >
                          {warning}
                        </div>
                      ))}
                    </div>
                  </div>

                  {extractReleaseNotesSection(plan.releaseNotes, "Scan Findings") ? (
                    <div className="rounded-md border border-rose-900/60 bg-rose-950/20 p-4">
                      <p className="text-xs uppercase tracking-wide text-rose-300">Scan Findings</p>
                      <pre className="mt-3 whitespace-pre-wrap text-xs text-rose-100">
                        {extractReleaseNotesSection(plan.releaseNotes, "Scan Findings")}
                      </pre>
                    </div>
                  ) : null}

                  <div className="rounded-md border border-gray-800 bg-gray-950 p-4">
                    <p className="text-xs uppercase tracking-wide text-gray-500">Rollback Plan</p>
                    <ol className="mt-3 space-y-2 text-sm text-gray-300">
                      {plan.rollbackPlan.map((step) => (
                        <li key={step} className="rounded-md border border-gray-800 bg-gray-900 px-3 py-2">
                          {step}
                        </li>
                      ))}
                    </ol>
                  </div>

                  <div className="rounded-md border border-gray-800 bg-gray-950 p-4">
                    <p className="text-xs uppercase tracking-wide text-gray-500">Links</p>
                    <div className="mt-3 flex flex-wrap gap-3">
                      {gate.latestRunId ? (
                        <Link
                          href={`/dashboard/runs/${gate.latestRunId}`}
                          className="rounded-md border border-gray-700 px-3 py-2 text-xs font-medium text-gray-200 transition hover:border-gray-600 hover:bg-gray-900"
                        >
                          View Run
                        </Link>
                      ) : null}
                      {plan.compareUrl ? (
                        <Link
                          href={plan.compareUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-md border border-emerald-800 px-3 py-2 text-xs font-medium text-emerald-200 transition hover:border-emerald-700 hover:bg-emerald-950/30"
                        >
                          Compare Branches
                        </Link>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
