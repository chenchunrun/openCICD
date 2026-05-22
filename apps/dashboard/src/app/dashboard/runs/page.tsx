import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  AICP_ACTOR_NAME,
  AICP_ACTOR_ROLE,
  canPerformRole,
  createGithubPullRequest,
  getRuns,
  stopRun,
  submitGithubReview,
} from "@/lib/api-client";
import { rethrowIfRedirectError } from "@/lib/server-action";

const STOPPABLE_STATUSES = new Set([
  "queued",
  "preparing",
  "running",
  "verifying",
  "reviewing",
  "repairing",
  "waiting_approval",
]);

function getErrorMessage(run: Awaited<ReturnType<typeof getRuns>>[number]) {
  const errorEvent = run.events?.find((event) => event.type === "error");
  if (!errorEvent) {
    return null;
  }

  return typeof errorEvent.data?.message === "string"
    ? errorEvent.data.message
    : JSON.stringify(errorEvent.data);
}

function getRepairSummary(run: Awaited<ReturnType<typeof getRuns>>[number]) {
  const latestRepair = run.repairs?.[0];
  const repairCount = run._count?.repairs ?? run.repairs?.length ?? 0;

  if (!latestRepair || repairCount === 0) {
    return null;
  }

  return {
    repairCount,
    latestFailureType: latestRepair.failureType,
    escalationReason: latestRepair.escalationReason,
  };
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

function getPolicyTone(filesystemMode?: string) {
  switch (filesystemMode) {
    case "read_only":
      return "border-emerald-900/50 bg-emerald-950/30 text-emerald-200";
    case "full_access":
      return "border-red-900/50 bg-red-950/30 text-red-200";
    default:
      return "border-sky-900/50 bg-sky-950/30 text-sky-200";
  }
}

function getPreparationMode(run: Awaited<ReturnType<typeof getRuns>>[number]) {
  const statusEvent = [...(run.events ?? [])].reverse().find(
    (event) =>
      event.type === "status" &&
      typeof event.data?.message === "string" &&
      event.data.message.includes("execution started"),
  );

  return typeof statusEvent?.data?.preparationMode === "string"
    ? statusEvent.data.preparationMode
    : null;
}

function getActionActorSummary(run: Awaited<ReturnType<typeof getRuns>>[number]) {
  const actionEvent = [...(run.events ?? [])].find((event) =>
    [
      "github_release_dispatched",
      "github_review_submitted",
      "github_pull_request_created",
    ].includes(event.type),
  );

  if (!actionEvent || !actionEvent.data || typeof actionEvent.data !== "object") {
    return null;
  }

  const actor = (actionEvent.data as Record<string, unknown>).actor;
  if (!actor || typeof actor !== "object") {
    return null;
  }

  const record = actor as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name : null;
  const role = typeof record.role === "string" ? record.role : null;
  const source = typeof record.source === "string" ? record.source : null;
  const label =
    actionEvent.type === "github_release_dispatched"
      ? "Release"
      : actionEvent.type === "github_review_submitted"
        ? "Review"
        : "PR";

  const parts = [name, role, source].filter(Boolean);
  return {
    label,
    summary: parts.length > 0 ? parts.join(" / ") : "Unknown actor",
  };
}

function getLatestEventData(
  run: Awaited<ReturnType<typeof getRuns>>[number],
  type: string,
) {
  return [...(run.events ?? [])]
    .reverse()
    .find((event) => event.type === type)?.data;
}

function getNoticeContent(notice?: string, runId?: string) {
  switch (notice) {
    case "stopped":
      return {
        tone: "success" as const,
        message: `Run ${runId ?? ""} was stopped.`.trim(),
      };
    case "pr_created":
      return {
        tone: "success" as const,
        message: `GitHub pull request created for run ${runId ?? ""}.`.trim(),
      };
    case "pr_exists":
      return {
        tone: "info" as const,
        message: `A pull request is already linked to run ${runId ?? ""}.`.trim(),
      };
    case "review_submitted":
      return {
        tone: "success" as const,
        message: `GitHub review submitted for run ${runId ?? ""}.`.trim(),
      };
    default:
      return null;
  }
}

async function stopRunAction(formData: FormData) {
  "use server";

  try {
    const runId = formData.get("runId");
    if (typeof runId !== "string" || runId.length === 0) {
      throw new Error("runId is required");
    }

    await stopRun(runId);
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/tasks");
    revalidatePath("/dashboard/runs");
    revalidatePath(`/dashboard/runs/${runId}`);
    redirect(`/dashboard/runs?notice=stopped&runId=${encodeURIComponent(runId)}`);
  } catch (error) {
    rethrowIfRedirectError(error);
    const message = error instanceof Error ? error.message : "Run stop failed";
    redirect(`/dashboard/runs?error=${encodeURIComponent(message)}`);
  }
}

async function createPullRequestAction(formData: FormData) {
  "use server";

  try {
    const runId = formData.get("runId");
    if (typeof runId !== "string" || runId.length === 0) {
      throw new Error("runId is required");
    }

    const result = await createGithubPullRequest(runId);
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/runs");
    revalidatePath(`/dashboard/runs/${runId}`);
    redirect(
      `/dashboard/runs?notice=${encodeURIComponent(result.alreadyExists ? "pr_exists" : "pr_created")}&runId=${encodeURIComponent(runId)}`,
    );
  } catch (error) {
    rethrowIfRedirectError(error);
    const message = error instanceof Error ? error.message : "GitHub PR creation failed";
    redirect(`/dashboard/runs?error=${encodeURIComponent(message)}`);
  }
}

async function submitReviewAction(formData: FormData) {
  "use server";

  try {
    const runId = formData.get("runId");
    if (typeof runId !== "string" || runId.length === 0) {
      throw new Error("runId is required");
    }

    await submitGithubReview(runId);
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/runs");
    revalidatePath(`/dashboard/runs/${runId}`);
    redirect(`/dashboard/runs?notice=review_submitted&runId=${encodeURIComponent(runId)}`);
  } catch (error) {
    rethrowIfRedirectError(error);
    const message = error instanceof Error ? error.message : "GitHub review submission failed";
    redirect(`/dashboard/runs?error=${encodeURIComponent(message)}`);
  }
}

export default async function DashboardRunsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const runs = await getRuns();
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const noticeParam = typeof resolvedSearchParams?.notice === "string" ? resolvedSearchParams.notice : undefined;
  const runIdParam = typeof resolvedSearchParams?.runId === "string" ? resolvedSearchParams.runId : undefined;
  const errorParam = typeof resolvedSearchParams?.error === "string" ? resolvedSearchParams.error : undefined;
  const notice = getNoticeContent(noticeParam, runIdParam);
  const canOperateGithub = canPerformRole("operator");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Runs</h1>
        <p className="mt-1 text-sm text-gray-400">
          Inspect agent execution status and drill into event streams.
        </p>
      </div>

      <div className="rounded-lg border border-gray-800 bg-gray-900 px-4 py-3 text-sm text-gray-300">
        Actor: <span className="font-medium text-white">{AICP_ACTOR_NAME}</span> · role{" "}
        <span className="font-medium text-white">{AICP_ACTOR_ROLE}</span>. GitHub PR creation and review submission require{" "}
        <span className="font-medium text-sky-200">operator</span> or higher.
      </div>

      {notice ? (
        <div
          className={
            notice.tone === "success"
              ? "rounded-lg border border-emerald-800 bg-emerald-950/50 px-4 py-3 text-sm text-emerald-200"
              : "rounded-lg border border-sky-800 bg-sky-950/50 px-4 py-3 text-sm text-sky-200"
          }
        >
          {notice.message}
        </div>
      ) : null}

      {errorParam ? (
        <div className="rounded-lg border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-200">
          {errorParam}
        </div>
      ) : null}

      <div className="grid gap-4">
        {runs.map((run) => {
          const errorMessage = getErrorMessage(run);
          const repairSummary = getRepairSummary(run);
          const securitySummary = getSecurityScanSummary(run);
          const isStoppable = STOPPABLE_STATUSES.has(run.status);
          const networkDomains = run.task?.networkDomains ?? [];
          const preparationMode = getPreparationMode(run);
          const actionActorSummary = getActionActorSummary(run);
          const pullRequestDelivery = getLatestEventData(run, "github_pull_request_created");
          const reviewDelivery = getLatestEventData(run, "github_review_submitted");
          const reviewCompleted = getLatestEventData(run, "review_completed");
          const pullRequestUrl =
            typeof pullRequestDelivery?.pullRequestUrl === "string"
              ? pullRequestDelivery.pullRequestUrl
              : run.pullRequestUrl ?? null;
          const reviewUrl =
            typeof reviewDelivery?.reviewUrl === "string"
              ? reviewDelivery.reviewUrl
              : null;
          const reviewVerdict =
            typeof reviewCompleted?.verdict === "string" ? reviewCompleted.verdict : null;
          const canSubmitReview =
            run.status === "completed" &&
            reviewVerdict !== null &&
            !reviewUrl;
          const canCreatePr =
            run.status === "completed" &&
            !pullRequestUrl;

          return (
            <div
              key={run.id}
              className={`rounded-lg border bg-gray-900 p-4 transition ${
                securitySummary
                  ? "border-rose-900/70 hover:border-rose-800"
                  : "border-gray-800 hover:border-gray-700"
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <Link href={`/dashboard/runs/${run.id}`} className="min-w-0 flex-1">
                  <p className="text-sm text-gray-400">Run {run.id.slice(0, 8)}</p>
                  <h2 className="mt-1 text-base font-semibold text-white">{run.agentName}</h2>
                  <p className="mt-2 text-sm text-gray-300">Task: {run.taskId}</p>
                  {run.task ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {preparationMode ? (
                        <span className="rounded-full border border-gray-700 bg-gray-950 px-2 py-1 text-xs text-gray-200">
                          prep: {preparationMode}
                        </span>
                      ) : null}
                      <span
                        className={`rounded-full border px-2 py-1 text-xs ${getPolicyTone(
                          run.task.filesystemMode,
                        )}`}
                      >
                        fs: {run.task.filesystemMode}
                      </span>
                      <span className="rounded-full border border-gray-700 bg-gray-950 px-2 py-1 text-xs text-gray-200">
                        net: {run.task.networkMode}
                        {run.task.networkMode === "allowlist"
                          ? ` (${networkDomains.length || 0} domains)`
                          : ""}
                      </span>
                      <span className="rounded-full border border-gray-700 bg-gray-950 px-2 py-1 text-xs text-gray-200">
                        secrets: {run.task.secretsMode}
                      </span>
                    </div>
                  ) : null}
                  {repairSummary ? (
                    <div className="mt-3 rounded-md border border-amber-900/70 bg-amber-950/30 px-3 py-2 text-sm text-amber-200">
                      <p>
                        Repair loops: {repairSummary.repairCount} | Latest: {repairSummary.latestFailureType}
                      </p>
                      {repairSummary.escalationReason ? (
                        <p className="mt-1 text-xs text-amber-300/90">{repairSummary.escalationReason}</p>
                      ) : null}
                    </div>
                  ) : null}
                  {securitySummary ? (
                    <div className="mt-3 rounded-md border border-rose-900/70 bg-rose-950/30 px-3 py-2 text-sm text-rose-200">
                      <p>
                        Security block:
                        {securitySummary.secretScan ? " secret_scan" : ""}
                        {(securitySummary.secretScan && securitySummary.sastScan) ||
                        (securitySummary.secretScan && securitySummary.dependencyScan) ||
                        (securitySummary.secretScan && securitySummary.licenseScan)
                          ? " +"
                          : ""}
                        {securitySummary.sastScan ? " sast_scan" : ""}
                        {(securitySummary.sastScan && securitySummary.dependencyScan) ||
                        (securitySummary.sastScan && securitySummary.licenseScan)
                          ? " +"
                          : ""}
                        {securitySummary.dependencyScan ? " dependency_scan" : ""}
                        {(securitySummary.dependencyScan && securitySummary.licenseScan) ? " +" : ""}
                        {securitySummary.licenseScan ? " license_scan" : ""}
                      </p>
                      <p className="mt-1 text-xs text-rose-300/90">
                        Findings: {securitySummary.findings}
                      </p>
                    </div>
                  ) : null}
                  {errorMessage ? (
                    <p className="mt-3 line-clamp-2 text-sm text-red-300">{errorMessage}</p>
                  ) : null}
                  {actionActorSummary ? (
                    <div className="mt-3 rounded-md border border-violet-900/50 bg-violet-950/20 px-3 py-2 text-sm text-violet-200">
                      <p>
                        {actionActorSummary.label} actor: {actionActorSummary.summary}
                      </p>
                    </div>
                  ) : null}
                  {run.task?.networkMode === "disabled" ? (
                    <p className="mt-3 text-xs text-gray-500">
                      Runtime launched in offline mode.
                    </p>
                  ) : null}
                </Link>

                <div className="shrink-0 text-right">
                  <p
                    className={
                      securitySummary
                        ? "text-sm font-medium text-rose-300"
                        : run.status === "failed"
                        ? "text-sm font-medium text-red-300"
                        : run.status === "stopped"
                          ? "text-sm font-medium text-amber-300"
                          : "text-sm font-medium text-white"
                    }
                  >
                    {run.status}
                  </p>
                  <p className="mt-2 text-xs text-gray-400">
                    Started: {run.startedAt ? new Date(run.startedAt).toLocaleString() : "Not started"}
                  </p>
                  <div className="mt-3 flex justify-end gap-2">
                    {pullRequestUrl ? (
                      <Link
                        href={pullRequestUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-md border border-emerald-800 px-3 py-2 text-xs font-medium text-emerald-200 transition hover:border-emerald-700 hover:bg-emerald-950/30"
                      >
                        Open PR
                      </Link>
                    ) : (
                      <form action={createPullRequestAction}>
                        <input type="hidden" name="runId" value={run.id} />
                        <button
                          type="submit"
                          disabled={!canOperateGithub || !canCreatePr}
                          className={
                            canOperateGithub && canCreatePr
                              ? "rounded-md border border-emerald-800 px-3 py-2 text-xs font-medium text-emerald-200 transition hover:border-emerald-700 hover:bg-emerald-950/30"
                              : "rounded-md border border-gray-800 px-3 py-2 text-xs font-medium text-gray-500"
                          }
                        >
                          {canOperateGithub
                            ? canCreatePr
                              ? "Create PR"
                              : "PR Not Ready"
                            : "Operator Required"}
                        </button>
                      </form>
                    )}
                    {reviewUrl ? (
                      <Link
                        href={reviewUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-md border border-violet-800 px-3 py-2 text-xs font-medium text-violet-200 transition hover:border-violet-700 hover:bg-violet-950/30"
                      >
                        Open Review
                      </Link>
                    ) : (
                      <form action={submitReviewAction}>
                        <input type="hidden" name="runId" value={run.id} />
                        <button
                          type="submit"
                          disabled={!canOperateGithub || !canSubmitReview}
                          className={
                            canOperateGithub && canSubmitReview
                              ? "rounded-md border border-violet-800 px-3 py-2 text-xs font-medium text-violet-200 transition hover:border-violet-700 hover:bg-violet-950/30"
                              : "rounded-md border border-gray-800 px-3 py-2 text-xs font-medium text-gray-500"
                          }
                        >
                          {canOperateGithub
                            ? canSubmitReview
                              ? "Submit Review"
                              : "Review Not Ready"
                            : "Operator Required"}
                        </button>
                      </form>
                    )}
                    <Link
                      href={`/dashboard/runs/${run.id}`}
                      className="rounded-md border border-gray-700 px-3 py-2 text-xs font-medium text-gray-200 transition hover:border-gray-600 hover:bg-gray-950"
                    >
                      Details
                    </Link>
                    {isStoppable ? (
                      <form action={stopRunAction}>
                        <input type="hidden" name="runId" value={run.id} />
                        <button
                          type="submit"
                          className="rounded-md border border-red-800 bg-red-950/40 px-3 py-2 text-xs font-medium text-red-200 transition hover:bg-red-950/70"
                        >
                          Stop
                        </button>
                      </form>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        {runs.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-800 bg-gray-900/60 p-8 text-center text-gray-500">
            No runs available.
          </div>
        ) : null}
      </div>
    </div>
  );
}
