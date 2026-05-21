import { revalidatePath } from "next/cache";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  createGithubPullRequest,
  getGithubPullRequestPayload,
  getGithubReviewPayload,
  getRun,
  getRunDiff,
  getRunEvents,
  getRunEvidences,
  getRunRepairs,
  getRunReviewDraft,
  submitGithubReview,
  type RunEvent,
} from "@/lib/api-client";
import { rethrowIfRedirectError } from "@/lib/server-action";

function getLatestEvent(events: RunEvent[], type: string) {
  return [...events].reverse().find((event) => event.type === type);
}

function getEventMessage(event?: RunEvent | null) {
  if (!event) {
    return null;
  }

  return typeof event.data?.message === "string"
    ? event.data.message
    : JSON.stringify(event.data);
}

function normalizeChecks(value: unknown): Array<{ name: string; status: string }> {
  if (!value || typeof value !== "object") {
    return [];
  }

  return Object.entries(value as Record<string, unknown>).map(([name, status]) => ({
    name,
    status: String(status),
  }));
}

function getReviewFindingsCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function getReviewDraftComments(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry, index) => {
    const record = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
    return {
      id: `${index}-${String(record.path ?? "comment")}`,
      path: typeof record.path === "string" ? record.path : "unknown",
      line: typeof record.line === "number" ? record.line : null,
      body: typeof record.body === "string" ? record.body : "",
      severity: typeof record.severity === "string" ? record.severity : null,
      category: typeof record.category === "string" ? record.category : null,
    };
  });
}

function getSecretScanFindings(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry, index) => {
    const record = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
    return {
      id: `${index}-${String(record.type ?? "secret")}`,
      type: typeof record.type === "string" ? record.type : "unknown",
      match: typeof record.match === "string" ? record.match : "",
    };
  });
}

function getSastScanFindings(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry, index) => {
    const record = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
    return {
      id: `${index}-${String(record.type ?? "sast")}`,
      type: typeof record.type === "string" ? record.type : "unknown",
      match: typeof record.match === "string" ? record.match : "",
    };
  });
}

function getDependencyScanFindings(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry, index) => {
    const record = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
    return {
      id: `${index}-${String(record.type ?? "dependency")}`,
      type: typeof record.type === "string" ? record.type : "unknown",
      match: typeof record.match === "string" ? record.match : "",
    };
  });
}

function getLicenseScanFindings(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry, index) => {
    const record = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
    return {
      id: `${index}-${String(record.type ?? "license")}`,
      type: typeof record.type === "string" ? record.type : "unknown",
      match: typeof record.match === "string" ? record.match : "",
    };
  });
}

function toTextSnippet(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().slice(0, 240);
}

function getVerificationChecks(events: RunEvent[]) {
  return events
    .filter((event) => event.type === "verification_check_completed")
    .map((event) => ({
      id: event.id,
      checkName: typeof event.data?.checkName === "string" ? event.data.checkName : "unknown",
      status: typeof event.data?.status === "string" ? event.data.status : "unknown",
      exitCode: typeof event.data?.exitCode === "number" ? event.data.exitCode : null,
      stdout: toTextSnippet(event.data?.stdout),
      stderr: toTextSnippet(event.data?.stderr),
      timestamp: event.timestamp,
    }));
}

function getLatestStatusEvent(events: RunEvent[]) {
  return [...events]
    .reverse()
    .find(
      (event) =>
        event.type === "status" &&
        typeof event.data?.message === "string" &&
        event.data.message.includes("execution started"),
    );
}

function getContextBrokerSummary(events: RunEvent[]) {
  const event = getLatestEvent(events, "context_brokered");
  if (!event || !event.data || typeof event.data !== "object") {
    return null;
  }

  return event.data as Record<string, unknown>;
}

async function createPullRequestAction(formData: FormData) {
  "use server";

  try {
    const runId = formData.get("runId");
    if (typeof runId !== "string" || runId.length === 0) {
      throw new Error("runId is required");
    }

    const result = await createGithubPullRequest(runId);
    revalidatePath("/dashboard/runs");
    revalidatePath(`/dashboard/runs/${runId}`);
    redirect(
      `/dashboard/runs/${encodeURIComponent(runId)}?notice=${encodeURIComponent(
        result.alreadyExists ? "pr_exists" : "pr_created",
      )}`,
    );
  } catch (error) {
    rethrowIfRedirectError(error);
    const runId = formData.get("runId");
    const message = error instanceof Error ? error.message : "GitHub PR creation failed";
    redirect(`/dashboard/runs/${encodeURIComponent(String(runId ?? ""))}?error=${encodeURIComponent(message)}`);
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
    revalidatePath("/dashboard/runs");
    revalidatePath(`/dashboard/runs/${runId}`);
    redirect(`/dashboard/runs/${encodeURIComponent(runId)}?notice=review_submitted`);
  } catch (error) {
    rethrowIfRedirectError(error);
    const runId = formData.get("runId");
    const message = error instanceof Error ? error.message : "GitHub review submission failed";
    redirect(`/dashboard/runs/${encodeURIComponent(String(runId ?? ""))}?error=${encodeURIComponent(message)}`);
  }
}

export default async function DashboardRunDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const noticeParam = typeof resolvedSearchParams?.notice === "string" ? resolvedSearchParams.notice : undefined;
  const errorParam = typeof resolvedSearchParams?.error === "string" ? resolvedSearchParams.error : undefined;
  const [run, events, diff, evidences, repairs, reviewDraft, githubPullRequestPayload, githubReviewPayload] = await Promise.all([
    getRun(id),
    getRunEvents(id),
    getRunDiff(id),
    getRunEvidences(id),
    getRunRepairs(id),
    getRunReviewDraft(id),
    getGithubPullRequestPayload(id),
    getGithubReviewPayload(id),
  ]);
  const verificationEvent = getLatestEvent(events, "verification_completed");
  const verificationStartedEvent = getLatestEvent(events, "verification_started");
  const executionStartedEvent = getLatestStatusEvent(events);
  const contextBrokerSummary = getContextBrokerSummary(events);
  const errorEvent = getLatestEvent(events, "error");
  const stoppedEvent = getLatestEvent(events, "run_stopped");
  const reviewEvent = getLatestEvent(events, "review_completed");
  const reviewDraftEvent = getLatestEvent(events, "pr_review_draft_generated");
  const evidenceEvent = getLatestEvent(events, "evidence_generated");
  const prDraftEvent = getLatestEvent(events, "pr_draft_generated");
  const prDraftSkippedEvent = getLatestEvent(events, "pr_draft_skipped");
  const checks = normalizeChecks(verificationEvent?.data?.checks);
  const verificationChecks = getVerificationChecks(events);
  const testWeakeningDetected = verificationEvent?.data?.testWeakeningDetected === true;
  const secretScanDetected = verificationEvent?.data?.secretScanDetected === true;
  const secretScanFindings = getSecretScanFindings(verificationEvent?.data?.secretScanFindings);
  const sastScanDetected = verificationEvent?.data?.sastScanDetected === true;
  const sastScanFindings = getSastScanFindings(verificationEvent?.data?.sastScanFindings);
  const dependencyScanDetected = verificationEvent?.data?.dependencyScanDetected === true;
  const dependencyScanFindings = getDependencyScanFindings(verificationEvent?.data?.dependencyScanFindings);
  const licenseScanDetected = verificationEvent?.data?.licenseScanDetected === true;
  const licenseScanFindings = getLicenseScanFindings(verificationEvent?.data?.licenseScanFindings);
  const diffPreview = diff.diff.trim();
  const stoppedMessage = getEventMessage(stoppedEvent);
  const errorMessage = getEventMessage(errorEvent);
  const reviewSummary =
    typeof reviewEvent?.data?.summary === "string" ? reviewEvent.data.summary : "No review summary recorded.";
  const reviewVerdict =
    typeof reviewEvent?.data?.verdict === "string" ? reviewEvent.data.verdict : "not_run";
  const reviewAgent =
    typeof reviewEvent?.data?.agentName === "string" ? reviewEvent.data.agentName : null;
  const reviewFindingsCount = getReviewFindingsCount(reviewEvent?.data?.findings);
  const reviewDraftAction =
    typeof reviewDraft.action === "string"
      ? reviewDraft.action
      : typeof reviewDraftEvent?.data?.action === "string"
        ? reviewDraftEvent.data.action
        : null;
  const reviewDraftBody =
    typeof reviewDraft.body === "string"
      ? reviewDraft.body
      : typeof reviewDraftEvent?.data?.body === "string"
        ? reviewDraftEvent.data.body
        : null;
  const reviewDraftComments = getReviewDraftComments(
    reviewDraft.comments ?? reviewDraftEvent?.data?.comments,
  );
  const evidenceSchemaVersion =
    typeof evidenceEvent?.data?.schemaVersion === "string" ? evidenceEvent.data.schemaVersion : null;
  const prDraftTitle =
    typeof prDraftEvent?.data?.title === "string" ? prDraftEvent.data.title : null;
  const prDraftBody =
    typeof prDraftEvent?.data?.body === "string" ? prDraftEvent.data.body : null;
  const prDraftBaseBranch =
    typeof prDraftEvent?.data?.baseBranch === "string" ? prDraftEvent.data.baseBranch : null;
  const prDraftHeadBranch =
    typeof prDraftEvent?.data?.headBranch === "string" ? prDraftEvent.data.headBranch : run.branch ?? null;
  const prDraftCompareUrl =
    typeof prDraftEvent?.data?.compareUrl === "string" ? prDraftEvent.data.compareUrl : null;
  const prDraftSkippedReason = getEventMessage(prDraftSkippedEvent);
  const runtimeFilesystemMode =
    typeof executionStartedEvent?.data?.filesystemMode === "string"
      ? executionStartedEvent.data.filesystemMode
      : run.task?.filesystemMode ?? "unknown";
  const runtimeNetworkMode =
    typeof executionStartedEvent?.data?.networkMode === "string"
      ? executionStartedEvent.data.networkMode
      : run.task?.networkMode ?? "unknown";
  const runtimeNetworkDomains = Array.isArray(executionStartedEvent?.data?.networkDomains)
    ? executionStartedEvent.data.networkDomains.map((value) => String(value))
    : run.task?.networkDomains ?? [];
  const runtimeSecretsMode = run.task?.secretsMode ?? "unknown";
  const allowedPaths = run.task?.allowedPaths ?? [];
  const forbiddenPaths = run.task?.forbiddenPaths ?? [];
  const brokerTrustBoundaries =
    contextBrokerSummary?.trustBoundaries && typeof contextBrokerSummary.trustBoundaries === "object"
      ? (contextBrokerSummary.trustBoundaries as Record<string, unknown>)
      : null;
  const brokerSourceType =
    typeof contextBrokerSummary?.sourceType === "string" ? contextBrokerSummary.sourceType : null;
  const brokerRiskLevel =
    typeof contextBrokerSummary?.riskLevel === "string" ? contextBrokerSummary.riskLevel : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Run Detail</h1>
        <p className="mt-1 text-sm text-gray-400">
          {run.agentName} on task {run.taskId}
        </p>
      </div>

      {noticeParam ? (
        <div className="rounded-lg border border-emerald-800 bg-emerald-950/50 px-4 py-3 text-sm text-emerald-200">
          {noticeParam === "pr_created"
            ? "GitHub pull request created."
            : noticeParam === "pr_exists"
              ? "A pull request already exists for this run."
              : "GitHub review submitted."}
        </div>
      ) : null}

      {errorParam ? (
        <div className="rounded-lg border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-200">
          {errorParam}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500">Status</p>
          <p
            className={
              run.status === "failed"
                ? "mt-2 text-lg font-semibold text-red-300"
                : run.status === "stopped"
                  ? "mt-2 text-lg font-semibold text-amber-300"
                  : run.status === "completed"
                    ? "mt-2 text-lg font-semibold text-emerald-300"
                    : "mt-2 text-lg font-semibold text-white"
            }
          >
            {run.status}
          </p>
        </div>
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500">Started</p>
          <p className="mt-2 text-sm text-white">
            {run.startedAt ? new Date(run.startedAt).toLocaleString() : "Not started"}
          </p>
        </div>
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500">Finished</p>
          <p className="mt-2 text-sm text-white">
            {run.finishedAt ? new Date(run.finishedAt).toLocaleString() : "Still running"}
          </p>
        </div>
      </div>

      {stoppedEvent ? (
        <div className="rounded-lg border border-amber-900 bg-amber-950/40 px-4 py-4">
          <p className="text-xs uppercase tracking-wide text-amber-300">Stopped</p>
          <p className="mt-2 text-sm text-amber-100">
            {stoppedMessage ?? "Run was stopped before completion."}
          </p>
          <p className="mt-2 text-xs text-amber-300/80">
            {new Date(stoppedEvent.timestamp).toLocaleString()}
          </p>
        </div>
      ) : null}

      {errorEvent ? (
        <div className="rounded-lg border border-red-900 bg-red-950/40 px-4 py-4">
          <p className="text-xs uppercase tracking-wide text-red-300">Last Error</p>
          <p className="mt-2 text-sm text-red-100">{errorMessage}</p>
          <p className="mt-2 text-xs text-red-300/80">
            {new Date(errorEvent.timestamp).toLocaleString()}
          </p>
        </div>
      ) : null}

      <div className="rounded-lg border border-gray-800 bg-gray-900">
        <div className="border-b border-gray-800 px-4 py-3">
          <h2 className="text-sm font-semibold text-white">Execution Policy</h2>
        </div>
        <div className="space-y-4 px-4 py-4">
          <div className="grid gap-3 lg:grid-cols-4">
            <div className="rounded-md border border-gray-800 bg-gray-950 p-3">
              <p className="text-xs uppercase tracking-wide text-gray-500">Filesystem</p>
              <p className="mt-2 text-sm font-medium text-white">{runtimeFilesystemMode}</p>
            </div>
            <div className="rounded-md border border-gray-800 bg-gray-950 p-3">
              <p className="text-xs uppercase tracking-wide text-gray-500">Network</p>
              <p className="mt-2 text-sm font-medium text-white">{runtimeNetworkMode}</p>
            </div>
            <div className="rounded-md border border-gray-800 bg-gray-950 p-3">
              <p className="text-xs uppercase tracking-wide text-gray-500">Secrets</p>
              <p className="mt-2 text-sm font-medium text-white">{runtimeSecretsMode}</p>
            </div>
            <div className="rounded-md border border-gray-800 bg-gray-950 p-3">
              <p className="text-xs uppercase tracking-wide text-gray-500">Allowed Domains</p>
              <p className="mt-2 text-sm font-medium text-white">
                {runtimeNetworkDomains.length > 0 ? runtimeNetworkDomains.length : "none"}
              </p>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-md border border-gray-800 bg-gray-950 p-3">
              <p className="text-xs uppercase tracking-wide text-gray-500">Allowed Paths</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {allowedPaths.length > 0 ? (
                  allowedPaths.map((path) => (
                    <span
                      key={path}
                      className="rounded-full border border-emerald-900/50 bg-emerald-950/40 px-2 py-1 text-xs text-emerald-200"
                    >
                      {path}
                    </span>
                  ))
                ) : (
                  <span className="text-sm text-gray-500">No explicit allowlist.</span>
                )}
              </div>
            </div>
            <div className="rounded-md border border-gray-800 bg-gray-950 p-3">
              <p className="text-xs uppercase tracking-wide text-gray-500">Forbidden Paths</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {forbiddenPaths.length > 0 ? (
                  forbiddenPaths.map((path) => (
                    <span
                      key={path}
                      className="rounded-full border border-red-900/50 bg-red-950/40 px-2 py-1 text-xs text-red-200"
                    >
                      {path}
                    </span>
                  ))
                ) : (
                  <span className="text-sm text-gray-500">No forbidden paths recorded.</span>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-md border border-gray-800 bg-gray-950 p-3">
            <p className="text-xs uppercase tracking-wide text-gray-500">Runtime Interpretation</p>
            <p className="mt-2 text-sm text-gray-300">
              {runtimeNetworkMode === "disabled"
                ? "Network was launched in offline mode with proxy variables stripped."
                : runtimeNetworkMode === "allowlist"
                  ? "Network use was restricted to the declared allowlist."
                  : "Network was not restricted by runtime policy."}
            </p>
            <p className="mt-2 text-sm text-gray-300">
              {runtimeFilesystemMode === "read_only"
                ? "Sandbox writes were blocked by filesystem permissions."
                : runtimeFilesystemMode === "workspace_write"
                  ? "Writes were allowed only inside the prepared sandbox workspace."
                  : "The run used full filesystem access."}
            </p>
          </div>
        </div>
      </div>

      {contextBrokerSummary ? (
        <div className="rounded-lg border border-gray-800 bg-gray-900">
          <div className="border-b border-gray-800 px-4 py-3">
            <h2 className="text-sm font-semibold text-white">Context Broker</h2>
          </div>
          <div className="space-y-4 px-4 py-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-md border border-gray-800 bg-gray-950 p-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">Source Type</p>
                <p className="mt-2 text-sm font-medium text-white">{brokerSourceType ?? "unknown"}</p>
              </div>
              <div className="rounded-md border border-gray-800 bg-gray-950 p-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">Risk Level</p>
                <p className="mt-2 text-sm font-medium text-white">{brokerRiskLevel ?? "unknown"}</p>
              </div>
              <div className="rounded-md border border-gray-800 bg-gray-950 p-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">Human Approval</p>
                <p className="mt-2 text-sm font-medium text-white">
                  {brokerTrustBoundaries?.requiresHumanApproval === true ? "required" : "not required"}
                </p>
              </div>
            </div>
            <div className="rounded-md border border-gray-800 bg-gray-950 p-3">
              <p className="text-xs uppercase tracking-wide text-gray-500">Trust Boundaries</p>
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs text-gray-300">
                {JSON.stringify(brokerTrustBoundaries ?? {}, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-gray-800 bg-gray-900">
          <div className="border-b border-gray-800 px-4 py-3">
            <h2 className="text-sm font-semibold text-white">Verification</h2>
          </div>
          <div className="space-y-4 px-4 py-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {checks.map((check) => (
                <div key={check.name} className="rounded-md border border-gray-800 bg-gray-950 p-3">
                  <p className="text-xs uppercase tracking-wide text-gray-500">{check.name}</p>
                  <p className="mt-2 text-sm font-medium text-white">{check.status}</p>
                </div>
              ))}
              {checks.length === 0 ? (
                <div className="rounded-md border border-dashed border-gray-800 bg-gray-950 p-4 text-sm text-gray-500 sm:col-span-2">
                  No verification results recorded.
                </div>
              ) : null}
            </div>
            <div className="rounded-md border border-gray-800 bg-gray-950 p-3">
              <p className="text-xs uppercase tracking-wide text-gray-500">Test Weakening</p>
              <p className="mt-2 text-sm text-white">
                {verificationEvent
                  ? testWeakeningDetected
                    ? "Detected"
                    : "Not detected"
                  : "Not run"}
              </p>
            </div>
            <div className="rounded-md border border-gray-800 bg-gray-950 p-3">
              <p className="text-xs uppercase tracking-wide text-gray-500">Secret Scan</p>
              <p className="mt-2 text-sm text-white">
                {verificationEvent
                  ? secretScanDetected
                    ? `Detected (${secretScanFindings.length})`
                    : "Not detected"
                  : "Not run"}
              </p>
            </div>
            <div className="rounded-md border border-gray-800 bg-gray-950 p-3">
              <p className="text-xs uppercase tracking-wide text-gray-500">SAST Scan</p>
              <p className="mt-2 text-sm text-white">
                {verificationEvent
                  ? sastScanDetected
                    ? `Detected (${sastScanFindings.length})`
                    : "Not detected"
                  : "Not run"}
              </p>
            </div>
            <div className="rounded-md border border-gray-800 bg-gray-950 p-3">
              <p className="text-xs uppercase tracking-wide text-gray-500">Dependency Scan</p>
              <p className="mt-2 text-sm text-white">
                {verificationEvent
                  ? dependencyScanDetected
                    ? `Detected (${dependencyScanFindings.length})`
                    : "Not detected"
                  : "Not run"}
              </p>
            </div>
            <div className="rounded-md border border-gray-800 bg-gray-950 p-3">
              <p className="text-xs uppercase tracking-wide text-gray-500">License Scan</p>
              <p className="mt-2 text-sm text-white">
                {verificationEvent
                  ? licenseScanDetected
                    ? `Detected (${licenseScanFindings.length})`
                    : "Not detected"
                  : "Not run"}
              </p>
            </div>
            {secretScanFindings.length > 0 ? (
              <div className="rounded-md border border-red-900 bg-red-950/30 p-3 sm:col-span-2">
                <p className="text-xs uppercase tracking-wide text-red-300">Secret Scan Findings</p>
                <div className="mt-3 space-y-2">
                  {secretScanFindings.map((finding) => (
                    <div key={finding.id} className="rounded-md border border-red-900/50 bg-red-950/40 p-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-red-200">
                        {finding.type}
                      </p>
                      <p className="mt-2 break-all text-xs text-red-100">{finding.match}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {sastScanFindings.length > 0 ? (
              <div className="rounded-md border border-amber-900 bg-amber-950/30 p-3 sm:col-span-2">
                <p className="text-xs uppercase tracking-wide text-amber-300">SAST Findings</p>
                <div className="mt-3 space-y-2">
                  {sastScanFindings.map((finding) => (
                    <div key={finding.id} className="rounded-md border border-amber-900/50 bg-amber-950/40 p-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-amber-200">
                        {finding.type}
                      </p>
                      <p className="mt-2 break-all text-xs text-amber-100">{finding.match}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {dependencyScanFindings.length > 0 ? (
              <div className="rounded-md border border-fuchsia-900 bg-fuchsia-950/30 p-3 sm:col-span-2">
                <p className="text-xs uppercase tracking-wide text-fuchsia-300">Dependency Scan Findings</p>
                <div className="mt-3 space-y-2">
                  {dependencyScanFindings.map((finding) => (
                    <div key={finding.id} className="rounded-md border border-fuchsia-900/50 bg-fuchsia-950/40 p-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-fuchsia-200">
                        {finding.type}
                      </p>
                      <p className="mt-2 break-all text-xs text-fuchsia-100">{finding.match}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {licenseScanFindings.length > 0 ? (
              <div className="rounded-md border border-violet-900 bg-violet-950/30 p-3 sm:col-span-2">
                <p className="text-xs uppercase tracking-wide text-violet-300">License Scan Findings</p>
                <div className="mt-3 space-y-2">
                  {licenseScanFindings.map((finding) => (
                    <div key={finding.id} className="rounded-md border border-violet-900/50 bg-violet-950/40 p-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-violet-200">
                        {finding.type}
                      </p>
                      <p className="mt-2 break-all text-xs text-violet-100">{finding.match}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="rounded-md border border-gray-800 bg-gray-950 p-3">
              <p className="text-xs uppercase tracking-wide text-gray-500">Verification Timeline</p>
              <div className="mt-3 space-y-3">
                {verificationChecks.map((check) => (
                  <div key={check.id} className="rounded-md border border-gray-800 bg-gray-900 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-white">{check.checkName}</p>
                      <p
                        className={
                          check.status === "passed"
                            ? "text-xs font-medium text-emerald-300"
                            : check.status === "failed"
                              ? "text-xs font-medium text-red-300"
                              : "text-xs font-medium text-gray-400"
                        }
                      >
                        {check.status}
                        {check.exitCode !== null ? ` (exit ${check.exitCode})` : ""}
                      </p>
                    </div>
                    {check.stderr || check.stdout ? (
                      <p className="mt-2 whitespace-pre-wrap text-xs text-gray-400">
                        {check.stderr || check.stdout}
                      </p>
                    ) : null}
                    <p className="mt-2 text-[11px] text-gray-500">
                      {new Date(check.timestamp).toLocaleString()}
                    </p>
                  </div>
                ))}
                {verificationChecks.length === 0 ? (
                  <p className="text-sm text-gray-500">
                    {verificationStartedEvent ? "Verification is running." : "Verification has not started."}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-gray-800 bg-gray-900">
          <div className="border-b border-gray-800 px-4 py-3">
            <h2 className="text-sm font-semibold text-white">Diff Summary</h2>
          </div>
          <div className="space-y-4 px-4 py-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-md border border-gray-800 bg-gray-950 p-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">Changed Files</p>
                <p className="mt-2 text-sm font-medium text-white">{diff.summary.changedFiles ?? 0}</p>
              </div>
              <div className="rounded-md border border-gray-800 bg-gray-950 p-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">Additions</p>
                <p className="mt-2 text-sm font-medium text-white">{diff.summary.additions ?? 0}</p>
              </div>
              <div className="rounded-md border border-gray-800 bg-gray-950 p-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">Deletions</p>
                <p className="mt-2 text-sm font-medium text-white">{diff.summary.deletions ?? 0}</p>
              </div>
            </div>
            <div className="rounded-md border border-gray-800 bg-gray-950 p-3">
              <p className="text-xs uppercase tracking-wide text-gray-500">Files</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {(run.filesChanged ?? []).map((file) => (
                  <span
                    key={file}
                    className="rounded-full border border-gray-800 px-2 py-1 text-xs text-gray-300"
                  >
                    {file}
                  </span>
                ))}
                {(run.filesChanged ?? []).length === 0 ? (
                  <span className="text-sm text-gray-500">No file changes recorded.</span>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-gray-800 bg-gray-900">
          <div className="border-b border-gray-800 px-4 py-3">
            <h2 className="text-sm font-semibold text-white">PR Draft</h2>
          </div>
          <div className="space-y-4 px-4 py-4">
            {prDraftEvent ? (
              <>
                <div className="rounded-md border border-gray-800 bg-gray-950 p-3">
                  <p className="text-xs uppercase tracking-wide text-gray-500">Title</p>
                  <p className="mt-2 text-sm font-medium text-white">{prDraftTitle}</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-md border border-gray-800 bg-gray-950 p-3">
                    <p className="text-xs uppercase tracking-wide text-gray-500">Base Branch</p>
                    <p className="mt-2 text-sm text-white">{prDraftBaseBranch ?? "unknown"}</p>
                  </div>
                  <div className="rounded-md border border-gray-800 bg-gray-950 p-3">
                    <p className="text-xs uppercase tracking-wide text-gray-500">Head Branch</p>
                    <p className="mt-2 text-sm text-white">{prDraftHeadBranch ?? "unknown"}</p>
                  </div>
                </div>
                <div className="rounded-md border border-gray-800 bg-gray-950 p-3">
                  <p className="text-xs uppercase tracking-wide text-gray-500">Body</p>
                  <pre className="mt-2 whitespace-pre-wrap text-xs text-gray-300">{prDraftBody}</pre>
                </div>
                {prDraftCompareUrl ? (
                  <Link
                    href={prDraftCompareUrl}
                    className="inline-flex text-sm font-medium text-emerald-300 hover:text-emerald-200"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open compare view
                  </Link>
                ) : null}
                <form action={createPullRequestAction}>
                  <input type="hidden" name="runId" value={id} />
                  <button
                    type="submit"
                    className="inline-flex rounded-md border border-emerald-800 px-3 py-2 text-sm font-medium text-emerald-200 transition hover:border-emerald-700 hover:bg-emerald-950/30"
                  >
                    {run.pullRequestUrl ? "PR Already Linked" : "Create GitHub PR"}
                  </button>
                </form>
                {githubPullRequestPayload.available && githubPullRequestPayload.github ? (
                  <div className="rounded-md border border-gray-800 bg-gray-950 p-3">
                    <p className="text-xs uppercase tracking-wide text-gray-500">GitHub PR Payload</p>
                    <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs text-gray-300">
                      {JSON.stringify(githubPullRequestPayload.github, null, 2)}
                    </pre>
                  </div>
                ) : null}
              </>
            ) : prDraftSkippedEvent ? (
              <div className="rounded-md border border-dashed border-gray-800 bg-gray-950 p-4 text-sm text-gray-400">
                {prDraftSkippedReason}
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-gray-800 bg-gray-950 p-4 text-sm text-gray-500">
                No PR draft has been generated for this run.
              </div>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-gray-800 bg-gray-900">
          <div className="border-b border-gray-800 px-4 py-3">
            <h2 className="text-sm font-semibold text-white">Review</h2>
          </div>
          <div className="space-y-4 px-4 py-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-md border border-gray-800 bg-gray-950 p-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">Verdict</p>
                <p
                  className={
                    reviewVerdict === "approved"
                      ? "mt-2 text-sm font-medium text-emerald-300"
                      : reviewVerdict === "requires_changes" || reviewVerdict === "blocked"
                        ? "mt-2 text-sm font-medium text-red-300"
                        : "mt-2 text-sm font-medium text-white"
                  }
                >
                  {reviewVerdict}
                </p>
              </div>
              <div className="rounded-md border border-gray-800 bg-gray-950 p-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">Review Agent</p>
                <p className="mt-2 text-sm font-medium text-white">{reviewAgent ?? "Not run"}</p>
              </div>
              <div className="rounded-md border border-gray-800 bg-gray-950 p-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">Findings</p>
                <p className="mt-2 text-sm font-medium text-white">
                  {reviewEvent ? reviewFindingsCount : "Not run"}
                </p>
              </div>
            </div>
            <div className="rounded-md border border-gray-800 bg-gray-950 p-3">
              <p className="text-xs uppercase tracking-wide text-gray-500">Summary</p>
              <p className="mt-2 text-sm text-white">{reviewSummary}</p>
            </div>
            <div className="rounded-md border border-gray-800 bg-gray-950 p-3">
              <p className="text-xs uppercase tracking-wide text-gray-500">PR Review Draft</p>
                {reviewDraftEvent ? (
                <div className="mt-2 space-y-3">
                  <p className="text-sm text-white">
                    Suggested action:{" "}
                    <span className="font-medium">{reviewDraftAction ?? "COMMENT"}</span>
                  </p>
                  <pre className="whitespace-pre-wrap text-xs text-gray-300">{reviewDraftBody}</pre>
                  {reviewDraftComments.length > 0 ? (
                    <div className="space-y-2">
                      {reviewDraftComments.map((comment) => (
                        <div key={comment.id} className="rounded-md border border-gray-800 bg-gray-900 p-3">
                          <p className="text-xs uppercase tracking-wide text-gray-500">
                            {comment.path}
                            {comment.line !== null ? `:${comment.line}` : ""}
                          </p>
                          {comment.severity || comment.category ? (
                            <p className="mt-1 text-[11px] text-gray-500">
                              {[comment.severity, comment.category].filter(Boolean).join(" / ")}
                            </p>
                          ) : null}
                          <pre className="mt-2 whitespace-pre-wrap text-xs text-gray-300">
                            {comment.body}
                          </pre>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">No inline review comments were drafted.</p>
                  )}
                  <form action={submitReviewAction}>
                    <input type="hidden" name="runId" value={id} />
                    <button
                      type="submit"
                      className="inline-flex rounded-md border border-sky-800 px-3 py-2 text-sm font-medium text-sky-200 transition hover:border-sky-700 hover:bg-sky-950/30"
                    >
                      Submit GitHub Review
                    </button>
                  </form>
                  {githubReviewPayload.available && githubReviewPayload.github ? (
                    <div className="rounded-md border border-gray-800 bg-gray-900 p-3">
                      <p className="text-xs uppercase tracking-wide text-gray-500">GitHub Review Payload</p>
                      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs text-gray-300">
                        {JSON.stringify(githubReviewPayload.github, null, 2)}
                      </pre>
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="mt-2 text-sm text-gray-500">No PR review draft generated.</p>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-gray-800 bg-gray-900">
          <div className="border-b border-gray-800 px-4 py-3">
            <h2 className="text-sm font-semibold text-white">Evidence</h2>
          </div>
          <div className="space-y-4 px-4 py-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-md border border-gray-800 bg-gray-950 p-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">Status</p>
                <p className="mt-2 text-sm font-medium text-white">
                  {evidenceEvent ? "generated" : "not_generated"}
                </p>
              </div>
              <div className="rounded-md border border-gray-800 bg-gray-950 p-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">Schema Version</p>
                <p className="mt-2 text-sm font-medium text-white">{evidenceSchemaVersion ?? "N/A"}</p>
              </div>
            </div>
            <div className="rounded-md border border-gray-800 bg-gray-950 p-3">
              <p className="text-xs uppercase tracking-wide text-gray-500">Generated At</p>
              <p className="mt-2 text-sm text-white">
                {evidenceEvent ? new Date(evidenceEvent.timestamp).toLocaleString() : "Not generated"}
              </p>
            </div>
            <div className="rounded-md border border-gray-800 bg-gray-950 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-wide text-gray-500">Linked Records</p>
                  <p className="mt-2 text-sm text-white">
                    {evidences.length > 0 ? `${evidences.length} evidence record(s)` : "No linked records"}
                  </p>
                </div>
                <Link
                  href={`/dashboard/evidence?runId=${encodeURIComponent(id)}`}
                  className="rounded-md border border-gray-700 px-3 py-2 text-xs font-medium text-gray-200 transition hover:border-gray-600 hover:bg-gray-900"
                >
                  View Evidence
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-gray-800 bg-gray-900">
        <div className="border-b border-gray-800 px-4 py-3">
          <h2 className="text-sm font-semibold text-white">Repair Loops</h2>
        </div>
        <div className="space-y-4 px-4 py-4">
          {repairs.length > 0 ? (
            <div className="space-y-3">
              {repairs.map((repair) => (
                <div key={repair.id} className="rounded-md border border-gray-800 bg-gray-950 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-gray-500">Loop {repair.loopNumber}</p>
                      <p className="mt-2 text-sm font-medium text-white">{repair.failureType}</p>
                      {repair.hypothesis ? (
                        <p className="mt-2 text-sm text-gray-300">{repair.hypothesis}</p>
                      ) : null}
                    </div>
                    <div className="text-right">
                      <p
                        className={
                          repair.verificationResult === "passed"
                            ? "text-sm font-medium text-emerald-300"
                            : repair.verificationResult === "skipped"
                              ? "text-sm font-medium text-amber-300"
                              : "text-sm font-medium text-white"
                        }
                      >
                        {repair.verificationResult ?? "pending"}
                      </p>
                      <p className="mt-2 text-xs text-gray-500">
                        {new Date(repair.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  {repair.escalationReason ? (
                    <div className="mt-3 rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-200">
                      {repair.escalationReason}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-gray-800 bg-gray-950 p-4 text-sm text-gray-500">
              No repair loops recorded.
            </div>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-gray-800 bg-gray-900">
        <div className="border-b border-gray-800 px-4 py-3">
          <h2 className="text-sm font-semibold text-white">Diff Preview</h2>
        </div>
        <div className="px-4 py-4">
          <pre className="overflow-x-auto rounded-md bg-gray-950 p-3 text-xs text-gray-300">
            {diffPreview || "No diff available."}
          </pre>
        </div>
      </div>

      <div className="rounded-lg border border-gray-800 bg-gray-900">
        <div className="border-b border-gray-800 px-4 py-3">
          <h2 className="text-sm font-semibold text-white">Events</h2>
        </div>
        <div className="divide-y divide-gray-800">
          {events.map((event) => (
            <div key={event.id} className="space-y-2 px-4 py-4">
              <div className="flex items-center justify-between gap-4">
                <p className="text-sm font-medium text-white">{event.type}</p>
                <p className="text-xs text-gray-500">
                  {new Date(event.timestamp).toLocaleString()}
                </p>
              </div>
              <pre className="overflow-x-auto rounded-md bg-gray-950 p-3 text-xs text-gray-300">
                {JSON.stringify(event.data, null, 2)}
              </pre>
            </div>
          ))}
          {events.length === 0 ? (
            <div className="px-4 py-8 text-center text-gray-500">No events captured.</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
