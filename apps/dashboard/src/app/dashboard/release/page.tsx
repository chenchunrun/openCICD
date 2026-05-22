import { revalidatePath } from "next/cache";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AICP_ACTOR_NAME,
  AICP_ACTOR_ROLE,
  approveTask,
  canPerformRole,
  dispatchGithubRelease,
  getReleaseGate,
  getReleasePlan,
  getRepos,
  getRepoWorkflowFileUrl,
  getRepoWorkflows,
  getTasks,
  syncGithubReleaseStatus,
} from "@/lib/api-client";
import { rethrowIfRedirectError } from "@/lib/server-action";

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

function formatDeliveryActor(
  actor?: {
    role?: string;
    name?: string;
    source?: string;
  } | null,
) {
  const parts = [actor?.name, actor?.role, actor?.source].filter(Boolean);
  return parts.length > 0 ? parts.join(" / ") : "Unknown actor";
}

function getWorkflowInstallTone(status: "installed" | "missing" | "drifted" | "unknown") {
  switch (status) {
    case "installed":
      return "text-emerald-300";
    case "missing":
      return "text-red-300";
    case "drifted":
      return "text-amber-300";
    default:
      return "text-gray-300";
  }
}

function getWorkflowBlockerStatus(
  gate: Awaited<ReturnType<typeof getReleaseGate>>,
  workflowStatus?: "installed" | "missing" | "drifted" | "unknown",
) {
  if (workflowStatus === "missing") {
    return "missing" as const;
  }
  if (workflowStatus === "drifted") {
    return "drifted" as const;
  }
  if (
    workflowStatus === "unknown" ||
    gate.warnings.some((warning) => warning.includes("could not be locally verified"))
  ) {
    return "unknown" as const;
  }

  return null;
}

function isWorkflowFilter(
  value?: string,
): value is "workflow_blocked" | "workflow_missing" | "workflow_drifted" | "workflow_unknown" {
  return (
    value === "workflow_blocked" ||
    value === "workflow_missing" ||
    value === "workflow_drifted" ||
    value === "workflow_unknown"
  );
}

function getWorkflowRemediationCopy(status: "missing" | "drifted" | "unknown") {
  switch (status) {
    case "missing":
      return "Install the generated workflow into the repository before dispatching release.";
    case "drifted":
      return "Reconcile the local workflow against the generated template before dispatching release.";
    default:
      return "Reconnect the repository with a local checkout so workflow installation can be verified.";
  }
}

async function dispatchReleaseAction(formData: FormData) {
  "use server";

  try {
    const taskId = formData.get("taskId");
    if (typeof taskId !== "string" || taskId.length === 0) {
      throw new Error("taskId is required");
    }

    await dispatchGithubRelease(taskId);
    revalidatePath("/dashboard/release");
    redirect(`/dashboard/release?notice=${encodeURIComponent(`release_dispatched:${taskId}`)}`);
  } catch (error) {
    rethrowIfRedirectError(error);
    const message = error instanceof Error ? error.message : "Release dispatch failed";
    redirect(`/dashboard/release?error=${encodeURIComponent(message)}`);
  }
}

async function approveTaskAction(formData: FormData) {
  "use server";

  try {
    const taskId = formData.get("taskId");
    const reason = formData.get("reason");
    if (typeof taskId !== "string" || taskId.length === 0) {
      throw new Error("taskId is required");
    }

    await approveTask(taskId, typeof reason === "string" && reason.trim().length > 0 ? reason.trim() : undefined);
    revalidatePath("/dashboard/release");
    revalidatePath("/dashboard/failures");
    redirect(`/dashboard/release?notice=${encodeURIComponent(`task_approved:${taskId}`)}`);
  } catch (error) {
    rethrowIfRedirectError(error);
    const message = error instanceof Error ? error.message : "Task approval failed";
    redirect(`/dashboard/release?error=${encodeURIComponent(message)}`);
  }
}

async function syncReleaseStatusAction(formData: FormData) {
  "use server";

  try {
    const taskId = formData.get("taskId");
    if (typeof taskId !== "string" || taskId.length === 0) {
      throw new Error("taskId is required");
    }

    const result = await syncGithubReleaseStatus(taskId);
    revalidatePath("/dashboard/release");
    redirect(
      `/dashboard/release?notice=${encodeURIComponent(
        result.found ? `release_status_synced:${taskId}` : `release_status_missing:${taskId}`,
      )}`,
    );
  } catch (error) {
    rethrowIfRedirectError(error);
    const message = error instanceof Error ? error.message : "Release status sync failed";
    redirect(`/dashboard/release?error=${encodeURIComponent(message)}`);
  }
}

export default async function DashboardReleasePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const noticeParam = typeof resolvedSearchParams?.notice === "string" ? resolvedSearchParams.notice : undefined;
  const errorParam = typeof resolvedSearchParams?.error === "string" ? resolvedSearchParams.error : undefined;
  const rawFilterParam = typeof resolvedSearchParams?.filter === "string" ? resolvedSearchParams.filter : undefined;
  const filterParam = isWorkflowFilter(rawFilterParam) ? rawFilterParam : undefined;
  const [tasks, repos] = await Promise.all([getTasks(), getRepos()]);
  const canDispatchRelease = canPerformRole("releaser");
  const candidateTasks = tasks
    .filter((task) => ["completed", "failed", "stopped", "in_progress"].includes(task.status))
    .slice(0, 8);

  const releaseItems = await Promise.all(
    candidateTasks.map(async (task) => {
      const [gate, plan] = await Promise.all([
        getReleaseGate(task.id),
        getReleasePlan(task.id),
      ]);

      const repoRecord = repos.find((repo) => repo.fullName === plan.repo) ?? null;
      const workflowBundle = repoRecord ? await getRepoWorkflows(repoRecord.id) : null;
      const releaseWorkflow =
        workflowBundle?.workflows.find((workflow) => workflow.filename === plan.githubDispatch.workflow) ?? null;
      const workflowBlockerStatus = getWorkflowBlockerStatus(
        gate,
        releaseWorkflow?.installation.status,
      );

      return {
        task,
        gate,
        plan,
        repoRecord,
        workflowBundle,
        releaseWorkflow,
        workflowBlockerStatus,
      };
    }),
  );
  const workflowBlockerItems = releaseItems.filter((item) => item.workflowBlockerStatus !== null);
  const filteredReleaseItems =
    filterParam === "workflow_blocked"
      ? workflowBlockerItems
      : filterParam === "workflow_missing"
        ? workflowBlockerItems.filter((item) => item.workflowBlockerStatus === "missing")
        : filterParam === "workflow_drifted"
          ? workflowBlockerItems.filter((item) => item.workflowBlockerStatus === "drifted")
          : filterParam === "workflow_unknown"
            ? workflowBlockerItems.filter((item) => item.workflowBlockerStatus === "unknown")
            : releaseItems;
  const workflowBlockerSummary = workflowBlockerItems.reduce(
    (summary, item) => {
      if (item.workflowBlockerStatus) {
        summary[item.workflowBlockerStatus] += 1;
      }
      return summary;
    },
    {
      missing: 0,
      drifted: 0,
      unknown: 0,
    } as Record<"missing" | "drifted" | "unknown", number>,
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Release Readiness</h1>
        <p className="mt-1 text-sm text-gray-400">
          Review structured release gates, blockers, and rollback plans before promoting AI-assisted changes.
        </p>
      </div>

      {noticeParam ? (
        <div className="rounded-lg border border-emerald-800 bg-emerald-950/50 px-4 py-3 text-sm text-emerald-200">
          {noticeParam.startsWith("release_dispatched:")
            ? `Release workflow dispatched for ${noticeParam.split(":")[1] ?? "task"}.`
            : noticeParam.startsWith("task_approved:")
              ? `Approval recorded for ${noticeParam.split(":")[1] ?? "task"}.`
            : noticeParam.startsWith("release_status_synced:")
              ? `Release workflow status synced for ${noticeParam.split(":")[1] ?? "task"}.`
              : `No GitHub workflow run was found yet for ${noticeParam.split(":")[1] ?? "task"}.`}
        </div>
      ) : null}

      {errorParam ? (
        <div className="rounded-lg border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-200">
          {errorParam}
        </div>
      ) : null}

      <div className="rounded-lg border border-gray-800 bg-gray-900 px-4 py-3 text-sm text-gray-300">
        Actor: <span className="font-medium text-white">{AICP_ACTOR_NAME}</span> · role{" "}
        <span className="font-medium text-white">{AICP_ACTOR_ROLE}</span>. Release dispatch requires <span className="font-medium text-sky-200">releaser</span> or higher.
      </div>

      <section className="rounded-lg border border-gray-800 bg-gray-900 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Workflow Blocker Queue</h2>
            <p className="mt-1 text-sm text-gray-500">
              Release candidates blocked because the required GitHub release workflow is missing, drifted, or not locally verifiable.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/dashboard/release"
              className={
                !filterParam
                  ? "rounded-md border border-sky-800 px-3 py-2 text-xs font-medium text-sky-200 transition hover:border-sky-700 hover:bg-sky-950/30"
                  : "rounded-md border border-gray-700 px-3 py-2 text-xs font-medium text-gray-200 transition hover:border-gray-600 hover:bg-gray-950"
              }
            >
              Show All
            </Link>
            <Link
              href="/dashboard/release?filter=workflow_blocked"
              className={
                filterParam === "workflow_blocked"
                  ? "rounded-md border border-sky-800 px-3 py-2 text-xs font-medium text-sky-200 transition hover:border-sky-700 hover:bg-sky-950/30"
                  : "rounded-md border border-gray-700 px-3 py-2 text-xs font-medium text-gray-200 transition hover:border-gray-600 hover:bg-gray-950"
              }
            >
              Workflow Blocked Only
            </Link>
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <Link
            href="/dashboard/release?filter=workflow_blocked"
            className={
              filterParam === "workflow_blocked"
                ? "rounded-md border border-sky-800 bg-sky-950/20 p-4"
                : "rounded-md border border-gray-800 bg-gray-950 p-4 transition hover:border-gray-700 hover:bg-gray-900"
            }
          >
            <p className="text-xs uppercase tracking-wide text-gray-500">Blocked Tasks</p>
            <p className="mt-2 text-2xl font-semibold text-white">{workflowBlockerItems.length}</p>
          </Link>
          <Link
            href="/dashboard/release?filter=workflow_missing"
            className={
              filterParam === "workflow_missing"
                ? "rounded-md border border-red-700 bg-red-950/30 p-4"
                : "rounded-md border border-red-900/50 bg-red-950/20 p-4 transition hover:border-red-800"
            }
          >
            <p className="text-xs uppercase tracking-wide text-red-300">Missing</p>
            <p className="mt-2 text-2xl font-semibold text-red-200">{workflowBlockerSummary.missing}</p>
          </Link>
          <Link
            href="/dashboard/release?filter=workflow_drifted"
            className={
              filterParam === "workflow_drifted"
                ? "rounded-md border border-amber-700 bg-amber-950/30 p-4"
                : "rounded-md border border-amber-900/50 bg-amber-950/20 p-4 transition hover:border-amber-800"
            }
          >
            <p className="text-xs uppercase tracking-wide text-amber-300">Drifted</p>
            <p className="mt-2 text-2xl font-semibold text-amber-200">{workflowBlockerSummary.drifted}</p>
          </Link>
          <Link
            href="/dashboard/release?filter=workflow_unknown"
            className={
              filterParam === "workflow_unknown"
                ? "rounded-md border border-gray-600 bg-gray-900 p-4"
                : "rounded-md border border-gray-800 bg-gray-950 p-4 transition hover:border-gray-700 hover:bg-gray-900"
            }
          >
            <p className="text-xs uppercase tracking-wide text-gray-400">Unknown</p>
            <p className="mt-2 text-2xl font-semibold text-gray-200">{workflowBlockerSummary.unknown}</p>
          </Link>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          <div className="rounded-md border border-red-900/50 bg-red-950/20 p-4">
            <p className="text-xs uppercase tracking-wide text-red-300">Missing Playbook</p>
            <p className="mt-2 text-sm text-red-100">
              Open the workflow pack, inspect the generated `ai-release.yml`, then commit it under `.github/workflows/`.
            </p>
          </div>
          <div className="rounded-md border border-amber-900/50 bg-amber-950/20 p-4">
            <p className="text-xs uppercase tracking-wide text-amber-300">Drifted Playbook</p>
            <p className="mt-2 text-sm text-amber-100">
              Compare the connected checkout against the generated template and remove unintended workflow edits.
            </p>
          </div>
          <div className="rounded-md border border-gray-800 bg-gray-950 p-4">
            <p className="text-xs uppercase tracking-wide text-gray-400">Unknown Playbook</p>
            <p className="mt-2 text-sm text-gray-300">
              Reconnect the repository with `localPath` so the control plane can verify workflow installation before release.
            </p>
          </div>
        </div>
      </section>

      {filteredReleaseItems.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-800 bg-gray-900/60 p-4 text-sm text-gray-500">
          {filterParam
            ? "No release candidates match the selected workflow blocker filter."
            : "No candidate tasks are available for release evaluation yet."}
        </div>
      ) : (
        <div className="space-y-6">
          {filteredReleaseItems.map(({ task, gate, plan, repoRecord, workflowBundle, releaseWorkflow, workflowBlockerStatus }) => {
            return (
            <section key={task.id} className="rounded-lg border border-gray-800 bg-gray-900">
              <div className="flex flex-col gap-3 border-b border-gray-800 px-5 py-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-gray-500">Task</p>
                  <h2 className="mt-2 text-lg font-semibold text-white">{task.goal}</h2>
                  <p className="mt-2 text-sm text-gray-400">
                    {task.id} · {plan.repo ?? "Unknown repo"}
                  </p>
                  {workflowBlockerStatus ? (
                    <p className={`mt-2 text-xs font-medium ${getWorkflowInstallTone(workflowBlockerStatus)}`}>
                      Workflow blocker: {workflowBlockerStatus}
                    </p>
                  ) : null}
                  {workflowBlockerStatus ? (
                    <p className="mt-2 text-xs text-gray-500">
                      {getWorkflowRemediationCopy(workflowBlockerStatus)}
                    </p>
                  ) : null}
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

                  <div className="rounded-md border border-gray-800 bg-gray-950 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs uppercase tracking-wide text-gray-500">GitHub Dispatch Readiness</p>
                      <span
                        className={
                          plan.githubDispatch.ready
                            ? "text-xs font-medium text-emerald-300"
                            : "text-xs font-medium text-amber-300"
                        }
                      >
                        {plan.githubDispatch.ready ? "ready" : "blocked"}
                      </span>
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-md border border-gray-800 bg-gray-900 p-3">
                        <p className="text-xs uppercase tracking-wide text-gray-500">Workflow</p>
                        <p className="mt-2 text-sm font-medium text-white">{plan.githubDispatch.workflow}</p>
                        <p className="mt-1 text-xs text-gray-500">{plan.githubDispatch.workflowPath}</p>
                        {releaseWorkflow ? (
                          <p className={`mt-2 text-xs font-medium ${getWorkflowInstallTone(releaseWorkflow.installation.status)}`}>
                            Local checkout: {releaseWorkflow.installation.status}
                          </p>
                        ) : null}
                      </div>
                      <div className="rounded-md border border-gray-800 bg-gray-900 p-3">
                        <p className="text-xs uppercase tracking-wide text-gray-500">Dispatch Endpoint</p>
                        <p className="mt-2 break-all text-xs text-gray-300">
                          {plan.githubDispatch.dispatchUrl ?? "Unavailable"}
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {plan.githubDispatch.actionsUrl ? (
                        <Link
                          href={plan.githubDispatch.actionsUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-md border border-sky-800 px-3 py-2 text-xs font-medium text-sky-200 transition hover:border-sky-700 hover:bg-sky-950/30"
                        >
                          Open Workflow
                        </Link>
                      ) : null}
                      {repoRecord ? (
                        <Link
                          href={`/dashboard/repos?repoId=${encodeURIComponent(repoRecord.id)}`}
                          className="rounded-md border border-gray-700 px-3 py-2 text-xs font-medium text-gray-200 transition hover:border-gray-600 hover:bg-gray-900"
                        >
                          Open Workflow Pack
                        </Link>
                      ) : null}
                      {repoRecord ? (
                        <Link
                          href={getRepoWorkflowFileUrl(repoRecord.id, plan.githubDispatch.workflow)}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-md border border-emerald-800 px-3 py-2 text-xs font-medium text-emerald-200 transition hover:border-emerald-700 hover:bg-emerald-950/30"
                        >
                          Open Generated Template
                        </Link>
                      ) : null}
                    </div>
                    <p className="mt-4 text-xs text-gray-500">
                      Release dispatch expects the generated workflow pack for this repository to include{" "}
                      <span className="font-medium text-gray-300">{plan.githubDispatch.workflowPath}</span>.
                    </p>
                    {releaseWorkflow ? (
                      <div
                        className={
                          releaseWorkflow.installation.status === "installed"
                            ? "mt-4 rounded-md border border-emerald-900 bg-emerald-950/20 p-3"
                            : releaseWorkflow.installation.status === "unknown"
                              ? "mt-4 rounded-md border border-amber-900 bg-amber-950/20 p-3"
                              : "mt-4 rounded-md border border-red-900 bg-red-950/20 p-3"
                        }
                      >
                        <p className="text-xs uppercase tracking-wide text-gray-400">Local Workflow Status</p>
                        <p className={`mt-2 text-sm ${getWorkflowInstallTone(releaseWorkflow.installation.status)}`}>
                          {releaseWorkflow.installation.detail}
                        </p>
                        {releaseWorkflow.secrets.length > 0 ? (
                          <p className="mt-2 text-xs text-gray-400">
                            Required secret: {releaseWorkflow.secrets.map((secret) => secret.name).join(", ")}. GitHub secret presence is not locally verifiable.
                          </p>
                        ) : null}
                      </div>
                    ) : workflowBundle?.localPath === null ? (
                      <div className="mt-4 rounded-md border border-amber-900 bg-amber-950/20 p-3">
                        <p className="text-xs uppercase tracking-wide text-amber-300">Verification Gap</p>
                        <p className="mt-2 text-sm text-amber-100">
                          No local checkout is connected for this repository, so workflow installation cannot be verified before dispatch.
                        </p>
                      </div>
                    ) : null}
                  </div>

                  {plan.deliveryActions.find((action) => action.type === "github_release_status_synced") ? (
                    <div className="rounded-md border border-violet-900/60 bg-violet-950/20 p-4">
                      <p className="text-xs uppercase tracking-wide text-violet-300">Release Workflow Status</p>
                      {plan.deliveryActions
                        .filter((action) => action.type === "github_release_status_synced")
                        .slice(0, 1)
                        .map((action, index) => {
                          const data = action as Record<string, unknown>;
                          return (
                            <div key={`${action.type ?? "status"}-${index}`} className="mt-3 space-y-2 text-sm text-violet-100">
                              <p>
                                Status: {typeof data.status === "string" ? data.status : "unknown"}
                                {typeof data.conclusion === "string" ? ` / ${data.conclusion}` : ""}
                              </p>
                              {action.targetUrl ? (
                                <Link
                                  href={action.targetUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex text-xs font-medium text-violet-200 hover:text-violet-100"
                                >
                                  Open workflow run
                                </Link>
                              ) : null}
                            </div>
                          );
                        })}
                    </div>
                  ) : null}

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

                  {plan.deliveryActions.length > 0 ? (
                    <div className="rounded-md border border-gray-800 bg-gray-950 p-4">
                      <p className="text-xs uppercase tracking-wide text-gray-500">Delivery Trail</p>
                      <div className="mt-3 space-y-2">
                        {plan.deliveryActions.map((action, index) => (
                          <div key={`${action.type ?? "delivery"}-${index}`} className="rounded-md border border-gray-800 bg-gray-900 p-3">
                            <p className="text-xs uppercase tracking-wide text-gray-500">{action.type ?? "delivery_action"}</p>
                            <p className="mt-2 text-sm text-white">{formatDeliveryActor(action.actor ?? null)}</p>
                            {action.targetUrl ? (
                              <Link
                                href={action.targetUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-2 inline-flex text-xs font-medium text-sky-300 hover:text-sky-200"
                              >
                                Open delivery target
                              </Link>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

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
                      {repoRecord ? (
                        <Link
                          href={`/dashboard/repos?repoId=${encodeURIComponent(repoRecord.id)}`}
                          className="rounded-md border border-gray-700 px-3 py-2 text-xs font-medium text-gray-200 transition hover:border-gray-600 hover:bg-gray-900"
                        >
                          Fix Workflow Pack
                        </Link>
                      ) : null}
                      {repoRecord ? (
                        <Link
                          href={getRepoWorkflowFileUrl(repoRecord.id, plan.githubDispatch.workflow)}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-md border border-emerald-800 px-3 py-2 text-xs font-medium text-emerald-200 transition hover:border-emerald-700 hover:bg-emerald-950/30"
                        >
                          Open Release Template
                        </Link>
                      ) : null}
                      <form action={approveTaskAction} className="flex items-center gap-2">
                        <input type="hidden" name="taskId" value={task.id} />
                        <input
                          type="text"
                          name="reason"
                          placeholder="Approval note (optional)"
                          className="w-44 rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-100 placeholder:text-gray-500"
                        />
                        <button
                          type="submit"
                          disabled={!canDispatchRelease || gate.checks.approval_received?.passed === true}
                          className={
                            canDispatchRelease && gate.checks.approval_received?.passed !== true
                              ? "rounded-md border border-emerald-800 px-3 py-2 text-xs font-medium text-emerald-200 transition hover:border-emerald-700 hover:bg-emerald-950/30"
                              : "rounded-md border border-gray-800 px-3 py-2 text-xs font-medium text-gray-500"
                          }
                        >
                          {gate.checks.approval_received?.passed
                            ? "Approval Recorded"
                            : canDispatchRelease
                              ? "Approve Task"
                              : "Releaser Role Required"}
                        </button>
                      </form>
                      <form action={dispatchReleaseAction}>
                        <input type="hidden" name="taskId" value={task.id} />
                        <button
                          type="submit"
                          disabled={!gate.canRelease || !canDispatchRelease}
                          className={
                            gate.canRelease && canDispatchRelease
                              ? "rounded-md border border-sky-800 px-3 py-2 text-xs font-medium text-sky-200 transition hover:border-sky-700 hover:bg-sky-950/30"
                              : "rounded-md border border-gray-800 px-3 py-2 text-xs font-medium text-gray-500"
                          }
                        >
                          {canDispatchRelease ? "Dispatch GitHub Release" : "Releaser Role Required"}
                        </button>
                      </form>
                      <form action={syncReleaseStatusAction}>
                        <input type="hidden" name="taskId" value={task.id} />
                        <button
                          type="submit"
                          disabled={!canDispatchRelease || !plan.deliveryActions.some((action) => action.type === "github_release_dispatched")}
                          className={
                            canDispatchRelease && plan.deliveryActions.some((action) => action.type === "github_release_dispatched")
                              ? "rounded-md border border-violet-800 px-3 py-2 text-xs font-medium text-violet-200 transition hover:border-violet-700 hover:bg-violet-950/30"
                              : "rounded-md border border-gray-800 px-3 py-2 text-xs font-medium text-gray-500"
                          }
                        >
                          {canDispatchRelease ? "Sync GitHub Status" : "Releaser Role Required"}
                        </button>
                      </form>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          );
          })}
        </div>
      )}
    </div>
  );
}
