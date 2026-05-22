const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export const AICP_ACTOR_ROLE =
  process.env.AICP_DASHBOARD_ROLE ??
  (process.env.NODE_ENV === "production" ? "viewer" : "admin");
export const AICP_ACTOR_NAME =
  process.env.AICP_DASHBOARD_ACTOR ??
  (process.env.NODE_ENV === "production" ? "dashboard" : "local-admin");
export const AICP_ACTOR_SOURCE = "dashboard";

const ROLE_LEVEL = {
  viewer: 0,
  operator: 1,
  releaser: 2,
  admin: 3,
} as const;

export function canPerformRole(requiredRole: keyof typeof ROLE_LEVEL) {
  const actorLevel = ROLE_LEVEL[AICP_ACTOR_ROLE as keyof typeof ROLE_LEVEL] ?? ROLE_LEVEL.viewer;
  return actorLevel >= ROLE_LEVEL[requiredRole];
}

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const payload = (await response.json()) as { message?: string | string[] };
    if (Array.isArray(payload.message)) {
      return payload.message.join("; ");
    }
    if (typeof payload.message === "string" && payload.message.length > 0) {
      return payload.message;
    }
  } catch {
    try {
      const text = await response.text();
      if (text.trim().length > 0) {
        return text;
      }
    } catch {
      return fallback;
    }
  }

  return fallback;
}

async function request<T>(path: string): Promise<T> {
  const url = `${API_URL}${path}`;
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      "x-aicp-role": AICP_ACTOR_ROLE,
      "x-aicp-actor": AICP_ACTOR_NAME,
      "x-aicp-source": AICP_ACTOR_SOURCE,
    },
    next: { revalidate: 0 },
  });

  if (!response.ok) {
    const message = await readErrorMessage(
      response,
      `API request failed: ${response.status} ${response.statusText}`,
    );
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-aicp-role": AICP_ACTOR_ROLE,
      "x-aicp-actor": AICP_ACTOR_NAME,
      "x-aicp-source": AICP_ACTOR_SOURCE,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (!response.ok) {
    const message = await readErrorMessage(
      response,
      `API request failed: ${response.status} ${response.statusText}`,
    );
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

export function getEvidenceExportBundleUrl(filters?: {
  taskIds?: string[];
  runIds?: string[];
  scanFindingsOnly?: boolean;
  approvalPendingOnly?: boolean;
  scanTypes?: string[];
  actionTypes?: string[];
}) {
  const url = new URL(`${API_URL}/api/evidence/export/bundle`);

  if (filters?.taskIds?.length) {
    url.searchParams.set("taskIds", filters.taskIds.join(","));
  }
  if (filters?.runIds?.length) {
    url.searchParams.set("runIds", filters.runIds.join(","));
  }
  if (filters?.scanFindingsOnly) {
    url.searchParams.set("scanFindingsOnly", "1");
  }
  if (filters?.approvalPendingOnly) {
    url.searchParams.set("approvalPendingOnly", "1");
  }
  if (filters?.scanTypes?.length) {
    url.searchParams.set("scanTypes", filters.scanTypes.join(","));
  }
  if (filters?.actionTypes?.length) {
    url.searchParams.set("actionTypes", filters.actionTypes.join(","));
  }

  return url.toString();
}

export interface EvidenceExportBundleResponse {
  generatedAt: string;
  filters: {
    taskIds?: string[];
    runIds?: string[];
    scanFindingsOnly?: boolean;
    approvalPendingOnly?: boolean;
    scanTypes?: string[];
    actionTypes?: string[];
  };
  summary: {
    evidenceCount: number;
    failedVerificationCount: number;
    approvalPendingCount: number;
    scanFindingTotals: Record<string, number>;
    deliveryActionTotals: Record<string, number>;
    preparationModeTotals: Record<string, number>;
    governanceActionTotals: Record<string, number>;
  };
  items: Array<{
    evidenceId: string;
    taskId?: string | null;
    runId?: string | null;
    repo?: string | null;
    schemaVersion?: string | null;
    status?: string | null;
    createdAt: string;
    execution: Record<string, unknown>;
    verification: {
      checks: Record<string, unknown>;
      scanFindings: Record<string, unknown>;
    };
    review: Record<string, unknown>;
    repair: Record<string, unknown>;
    residualRisk: Record<string, unknown>;
    context: Record<string, unknown>;
  }>;
  activity: Array<{
    evidenceId: string;
    taskId?: string | null;
    runId?: string | null;
    repo?: string | null;
    type: string;
    timestamp: string | null;
    targetUrl: string | null;
    actor: Record<string, unknown> | null;
  }>;
}

export interface Task {
  id: string;
  goal: string;
  status: string;
  preferredAgent?: string | null;
  createdAt?: string;
}

export interface Repo {
  id: string;
  fullName: string;
  platform: string;
  defaultBranch: string;
  url?: string;
  languages?: string[];
  packageManager?: string | null;
  hasAgentsMd?: boolean;
  hasClaudeMd?: boolean;
}

export interface RepoWorkflowBundle {
  repoId: string;
  repo: string;
  localPath: string | null;
  workflows: RepoWorkflowDefinition[];
}

export interface RepoWorkflowFile {
  repoId: string;
  repo: string;
  workflowName: string;
  workflowPath: string;
  content: string;
}

export interface RepoWorkflowDefinition {
  filename: string;
  displayName: string;
  purpose: string;
  installPath: string;
  triggers: string[];
  requiredSecrets: string[];
  content: string;
  installation: {
    status: "installed" | "missing" | "drifted" | "unknown";
    detail: string;
  };
  secrets: Array<{
    name: string;
    status: "required_but_unverified";
    detail: string;
  }>;
}

export interface WorkflowIntegrityIssue {
  repoId: string;
  repo: string;
  localPath: string | null;
  status: "missing" | "drifted" | "unknown";
  workflowNames: string[];
  detail: string;
}

export interface ReleaseWorkflowBlockerIssue {
  taskId: string;
  goal: string;
  repo: string | null;
  status: "missing" | "drifted" | "unknown";
  workflowPath: string;
  detail: string;
  blockers: string[];
}

export interface Run {
  id: string;
  taskId: string;
  agentName: string;
  status: string;
  branch?: string | null;
  pullRequestUrl?: string | null;
  startedAt: string | null;
  finishedAt?: string | null;
  filesChanged?: string[];
  diffSummary?: Record<string, unknown> | null;
  events?: RunEvent[];
  repairs?: RepairLoop[];
  task?: {
    filesystemMode: string;
    networkMode: string;
    networkDomains: string[];
    secretsMode: string;
    allowedPaths?: string[];
    forbiddenPaths?: string[];
  };
  _count?: {
    repairs: number;
  };
}

export interface RunEvent {
  id: string;
  runId: string;
  type: string;
  data: Record<string, unknown>;
  timestamp: string;
}

export interface RunDiffResponse {
  diff: string;
  summary: {
    additions?: number;
    deletions?: number;
    changedFiles?: number;
  };
}

export interface Evidence {
  id: string;
  runId: string | null;
  taskId?: string;
  status: string;
  repo?: string;
  schemaVersion?: string;
  executionSection?: {
    commandsRun?: string[];
    filesChanged?: string[];
    networkUsed?: boolean;
    secretsAccessed?: boolean;
    preparationMode?: string;
    deliveryActions?: Array<{
      type?: string;
      actor?: {
        role?: string;
        name?: string;
        source?: string;
      } | null;
      targetUrl?: string | null;
    }>;
  } | null;
  verificationSection?: Record<string, unknown> | null;
  reviewSection?: {
    aiReview?: string;
    humanReview?: string;
    codeOwnerApproval?: string;
  } | null;
  createdAt: string;
}

export interface RepairLoop {
  id: string;
  runId: string;
  loopNumber: number;
  failureType: string;
  hypothesis?: string | null;
  verificationResult?: string | null;
  escalationReason?: string | null;
  filesChanged?: string[];
  testsAdded?: string[];
  createdAt: string;
}

export interface ReviewDraftPayload {
  runId: string;
  available: boolean;
  reason?: string;
  action?: string;
  body?: string;
  comments?: Array<{
    path: string;
    line?: number;
    body: string;
    severity?: string;
    category?: string;
  }>;
  review?: {
    agentName: string;
    verdict: string;
    summary: string;
    reviewedAt: string;
  };
  pullRequest?: {
    title?: string | null;
    baseBranch?: string | null;
    headBranch?: string | null;
    compareUrl?: string | null;
    pullRequestUrl?: string | null;
  };
}

export interface GithubPullRequestPayload {
  runId: string;
  available: boolean;
  reason?: string;
  github?: {
    title: string;
    body: string;
    head: string;
    base: string;
    draft: boolean;
    maintainer_can_modify: boolean;
  };
  metadata?: {
    compareUrl?: string | null;
    pullRequestUrl?: string | null;
  };
}

export interface GithubReviewPayload {
  runId: string;
  available: boolean;
  reason?: string;
  github?: {
    event: string;
    body: string;
    comments: Array<{
      path: string;
      line?: number;
      side: string;
      body: string;
    }>;
    commit_id?: string;
  };
  metadata?: {
    verdict?: string;
    agentName?: string;
    reviewedAt?: string;
    pullRequest?: {
      title?: string | null;
      baseBranch?: string | null;
      headBranch?: string | null;
      compareUrl?: string | null;
      pullRequestUrl?: string | null;
    };
  };
}

export interface GithubPullRequestDeliveryResult {
  runId: string;
  created: boolean;
  alreadyExists?: boolean;
  pullRequestUrl?: string | null;
  number?: number | null;
  state?: string | null;
}

export interface GithubReviewDeliveryResult {
  runId: string;
  submitted: boolean;
  reviewId?: number | null;
  reviewUrl?: string | null;
  state?: string | null;
}

export interface ReleaseGateResponse {
  canRelease: boolean;
  latestRunId: string | null;
  brokeredContext: {
    riskLevel?: string;
    trustBoundaries?: {
      requiresHumanApproval?: boolean;
    };
  } | null;
  blockers: string[];
  warnings: string[];
  checks: Record<
    string,
    {
      passed: boolean;
      required: boolean;
      detail: string;
    }
  >;
}

export interface ReleasePlanResponse {
  taskId: string;
  repo: string | null;
  sourceSha: string | null;
  baseBranch: string | null;
  headBranch: string | null;
  compareUrl: string | null;
  brokeredContext: {
    riskLevel?: string;
    trustBoundaries?: {
      requiresHumanApproval?: boolean;
    };
  } | null;
  deliveryActions: Array<{
    type?: string;
    actor?: {
      role?: string;
      name?: string;
      source?: string;
    } | null;
    timestamp?: string | null;
    status?: string | null;
    conclusion?: string | null;
    workflowRunId?: number | null;
    targetUrl?: string | null;
  }>;
  githubDispatch: {
    ready: boolean;
    workflow: string;
    workflowPath: string;
    actionsUrl: string | null;
    dispatchUrl: string | null;
  };
  releaseNotes: string;
  rollbackPlan: string[];
  deploymentRecommendation: "ready" | "blocked";
  blockers: string[];
  warnings: string[];
}

export interface GithubReleaseDispatchResult {
  taskId: string;
  dispatched: boolean;
  workflow: string;
  repo: string;
  ref: string;
  actionsUrl: string;
}

export interface GithubReleaseSyncResult {
  taskId: string;
  synced: boolean;
  found: boolean;
  unchanged?: boolean;
  workflow: string;
  repo: string;
  ref: string;
  workflowRunId?: number | null;
  runNumber?: number | null;
  status?: string;
  conclusion?: string | null;
  htmlUrl?: string | null;
  actionsUrl?: string | null;
}

export interface Policy {
  id: string;
  repoId: string;
  layer: string;
  path?: string | null;
  priority?: number;
  active: boolean;
  sourceFile?: string | null;
}

async function requestOrDefault<T>(path: string, fallback: T): Promise<T> {
  try {
    return await request<T>(path);
  } catch {
    return fallback;
  }
}

function getSecurityScanBlockCount(run: Run): number {
  const verificationEvent = run.events?.find((event) => event.type === "verification_completed");
  if (!verificationEvent || !verificationEvent.data || typeof verificationEvent.data !== "object") {
    return 0;
  }

  const data = verificationEvent.data as Record<string, unknown>;
  const checks =
    data.checks && typeof data.checks === "object"
      ? (data.checks as Record<string, unknown>)
      : {};

  return ["secret_scan", "sast_scan", "dependency_scan", "license_scan"].filter(
    (checkName) => checks[checkName] === "failed",
  ).length;
}

export async function getTasks(): Promise<Task[]> {
  return request<Task[]>("/api/tasks");
}

export async function getRepos(): Promise<Repo[]> {
  return request<Repo[]>("/api/repos");
}

export async function getRepoWorkflows(repoId: string): Promise<RepoWorkflowBundle | null> {
  return request<RepoWorkflowBundle | null>(`/api/repos/${repoId}/workflows`);
}

export async function getWorkflowIntegrityIssues(): Promise<WorkflowIntegrityIssue[]> {
  const repos = await requestOrDefault<Repo[]>("/api/repos", []);
  const workflowBundles = await Promise.all(
    repos.map(async (repo) => ({
      repo,
      bundle: await requestOrDefault<RepoWorkflowBundle | null>(`/api/repos/${repo.id}/workflows`, null),
    })),
  );

  return workflowBundles.flatMap(({ repo, bundle }) => {
    if (!bundle) {
      return [];
    }

    const groupedStatuses = (["missing", "drifted", "unknown"] as const)
      .map((status) => {
        const workflows = bundle.workflows.filter((workflow) => workflow.installation.status === status);
        if (workflows.length === 0) {
          return null;
        }

        return {
          repoId: repo.id,
          repo: repo.fullName,
          localPath: bundle.localPath,
          status,
          workflowNames: workflows.map((workflow) => workflow.filename),
          detail: workflows[0]?.installation.detail ?? "Workflow state is unavailable.",
        } satisfies WorkflowIntegrityIssue;
      })
      .filter((issue): issue is WorkflowIntegrityIssue => issue !== null);

    return groupedStatuses;
  });
}

export async function getReleaseWorkflowBlockerIssues(): Promise<ReleaseWorkflowBlockerIssue[]> {
  const tasks = await requestOrDefault<Task[]>("/api/tasks", []);
  const candidateTasks = tasks
    .filter((task) => ["completed", "failed", "stopped", "in_progress"].includes(task.status))
    .slice(0, 8);

  const releaseItems = await Promise.all(
    candidateTasks.map(async (task) => {
      const [gate, plan] = await Promise.all([
        requestOrDefault<ReleaseGateResponse>(`/api/release/task/${task.id}/gate`, {
          canRelease: false,
          latestRunId: null,
          brokeredContext: null,
          blockers: [],
          warnings: [],
          checks: {},
        }),
        requestOrDefault<ReleasePlanResponse>(`/api/release/task/${task.id}/plan`, {
          taskId: task.id,
          repo: null,
          sourceSha: null,
          baseBranch: null,
          headBranch: null,
          compareUrl: null,
          brokeredContext: null,
          deliveryActions: [],
          githubDispatch: {
            ready: false,
            workflow: "ai-release.yml",
            workflowPath: ".github/workflows/ai-release.yml",
            actionsUrl: null,
            dispatchUrl: null,
          },
          releaseNotes: "",
          rollbackPlan: [],
          deploymentRecommendation: "blocked",
          blockers: [],
          warnings: [],
        }),
      ]);

      return { task, gate, plan };
    }),
  );

  return releaseItems.flatMap(({ task, gate, plan }) => {
    const workflowCheck = gate.checks.github_release_workflow_installed;
    if (!workflowCheck) {
      return [];
    }

    const missing = gate.blockers.some((blocker) => blocker.includes("is missing from the connected checkout"));
    const drifted = gate.blockers.some((blocker) => blocker.includes("has drifted from the generated template"));
    const unknown = gate.warnings.some((warning) => warning.includes("could not be locally verified"));

    if (!missing && !drifted && !unknown) {
      return [];
    }

    return [
      {
        taskId: task.id,
        goal: task.goal,
        repo: plan.repo,
        status: missing ? "missing" : drifted ? "drifted" : "unknown",
        workflowPath: plan.githubDispatch.workflowPath,
        detail: workflowCheck.detail,
        blockers: gate.blockers,
      } satisfies ReleaseWorkflowBlockerIssue,
    ];
  });
}

export function getRepoWorkflowFileUrl(repoId: string, workflowName: string): string {
  return `${API_URL}/api/repos/${repoId}/workflows/${encodeURIComponent(workflowName)}`;
}

export async function createRepo(input: {
  platform: string;
  owner: string;
  name: string;
  url: string;
  defaultBranch?: string;
  localPath?: string;
}): Promise<Repo> {
  const response = await fetch(`${API_URL}/api/repos`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-aicp-role": AICP_ACTOR_ROLE,
      "x-aicp-actor": AICP_ACTOR_NAME,
      "x-aicp-source": AICP_ACTOR_SOURCE,
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const message = await readErrorMessage(
      response,
      `Repository onboarding failed: ${response.status} ${response.statusText}`,
    );
    throw new Error(message);
  }

  return response.json() as Promise<Repo>;
}

export async function getRuns(): Promise<Run[]> {
  return request<Run[]>("/api/runs");
}

export async function getRun(runId: string): Promise<Run & { events: RunEvent[] }> {
  return request<Run & { events: RunEvent[] }>(`/api/runs/${runId}`);
}

export async function getRunEvents(runId: string): Promise<RunEvent[]> {
  return request<RunEvent[]>(`/api/runs/${runId}/events`);
}

export async function getRunDiff(runId: string): Promise<RunDiffResponse> {
  return request<RunDiffResponse>(`/api/runs/${runId}/diff`);
}

export async function stopRun(runId: string): Promise<Run> {
  return postJson<Run>(`/api/runs/${runId}/stop`);
}

export async function getEvidences(): Promise<Evidence[]> {
  return request<Evidence[]>("/api/evidence");
}

export async function getRunEvidences(runId: string): Promise<Evidence[]> {
  return request<Evidence[]>(`/api/evidence/run/${runId}`);
}

export async function getRunRepairs(runId: string): Promise<RepairLoop[]> {
  return request<RepairLoop[]>(`/api/repairs/run/${runId}`);
}

export async function getEvidenceExportBundle(filters?: {
  taskIds?: string[];
  runIds?: string[];
  scanFindingsOnly?: boolean;
  approvalPendingOnly?: boolean;
  scanTypes?: string[];
  actionTypes?: string[];
}): Promise<EvidenceExportBundleResponse> {
  return request<EvidenceExportBundleResponse>(
    getEvidenceExportBundleUrl(filters).replace(API_URL, ""),
  );
}

export async function getRunReviewDraft(runId: string): Promise<ReviewDraftPayload> {
  return request<ReviewDraftPayload>(`/api/reviews/run/${runId}/draft`);
}

export async function getGithubPullRequestPayload(runId: string): Promise<GithubPullRequestPayload> {
  return request<GithubPullRequestPayload>(`/api/reviews/run/${runId}/github/pull-request`);
}

export async function getGithubReviewPayload(runId: string): Promise<GithubReviewPayload> {
  return request<GithubReviewPayload>(`/api/reviews/run/${runId}/github/review`);
}

export async function createGithubPullRequest(runId: string): Promise<GithubPullRequestDeliveryResult> {
  return postJson<GithubPullRequestDeliveryResult>(`/api/reviews/run/${runId}/github/pull-request`);
}

export async function submitGithubReview(runId: string): Promise<GithubReviewDeliveryResult> {
  return postJson<GithubReviewDeliveryResult>(`/api/reviews/run/${runId}/github/review`);
}

export async function getReleaseGate(taskId: string): Promise<ReleaseGateResponse> {
  return request<ReleaseGateResponse>(`/api/release/task/${taskId}/gate`);
}

export async function getReleasePlan(taskId: string): Promise<ReleasePlanResponse> {
  return request<ReleasePlanResponse>(`/api/release/task/${taskId}/plan`);
}

export async function dispatchGithubRelease(taskId: string): Promise<GithubReleaseDispatchResult> {
  return postJson<GithubReleaseDispatchResult>(`/api/release/task/${taskId}/github/dispatch`);
}

export async function syncGithubReleaseStatus(taskId: string): Promise<GithubReleaseSyncResult> {
  return postJson<GithubReleaseSyncResult>(`/api/release/task/${taskId}/github/sync`);
}

export async function getPolicies(): Promise<Policy[]> {
  return request<Policy[]>("/api/policies");
}

export async function executeTask(taskId: string): Promise<{ taskId: string; status: string }> {
  return postJson<{ taskId: string; status: string }>(`/api/orchestrator/tasks/${taskId}/execute`);
}

export async function approveTask(taskId: string, reason?: string): Promise<Task> {
  return postJson<Task>(`/api/tasks/${taskId}/approve`, {
    approver: AICP_ACTOR_NAME,
    ...(reason ? { reason } : {}),
  });
}

export async function rejectTask(taskId: string, reason: string): Promise<Task> {
  return postJson<Task>(`/api/tasks/${taskId}/reject`, {
    approver: AICP_ACTOR_NAME,
    reason,
  });
}

export async function createTask(input: {
  repoId: string;
  goal: string;
  allowedPaths: string[];
  forbiddenPaths: string[];
  doneWhen: string[];
  constraints?: string[];
  preferredAgent?: string;
}): Promise<Task> {
  const response = await fetch(`${API_URL}/api/tasks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-aicp-role": AICP_ACTOR_ROLE,
      "x-aicp-actor": AICP_ACTOR_NAME,
      "x-aicp-source": AICP_ACTOR_SOURCE,
    },
    body: JSON.stringify({
      repoId: input.repoId,
      source: { type: "manual" },
      goal: input.goal,
      scope: {
        allowedPaths: input.allowedPaths,
        forbiddenPaths: input.forbiddenPaths,
      },
      doneWhen: input.doneWhen,
      constraints: input.constraints ?? [],
      preferredAgent: input.preferredAgent || undefined,
    }),
  });

  if (!response.ok) {
    const message = await readErrorMessage(
      response,
      `Task creation failed: ${response.status} ${response.statusText}`,
    );
    throw new Error(message);
  }

  return response.json() as Promise<Task>;
}

export async function getDashboardStats(): Promise<{
  activeTasks: number;
  runningAgents: number;
  pendingReviews: number;
  evidenceRecords: number;
  failedRuns: number;
  securityScanBlocks: number;
  runsWithRepairs: number;
  escalatedRepairs: number;
  approvalPendingEvidence: number;
  brokeredApprovalBlocks: number;
  scanEscalatedApprovalBlocks: number;
  totalScanFindings: number;
  governanceApprovals: number;
  governanceRejections: number;
  governanceStops: number;
  prDeliveries: number;
  reviewDeliveries: number;
  releaseDispatches: number;
  gitWorktreeEvidence: number;
  syntheticGitEvidence: number;
  workflowInstalledRepos: number;
  workflowMissingCount: number;
  workflowDriftedCount: number;
  workflowUnknownCount: number;
}> {
  const [tasks, runs, evidences, evidenceBundle, repos] = await Promise.all([
    requestOrDefault<Task[]>("/api/tasks", []),
    requestOrDefault<Run[]>("/api/runs", []),
    requestOrDefault<Evidence[]>("/api/evidence", []),
    requestOrDefault<EvidenceExportBundleResponse>("/api/evidence/export/bundle", {
      generatedAt: new Date(0).toISOString(),
      filters: {},
      summary: {
        evidenceCount: 0,
        failedVerificationCount: 0,
        approvalPendingCount: 0,
        scanFindingTotals: {},
        deliveryActionTotals: {},
        preparationModeTotals: {},
        governanceActionTotals: {},
      },
      items: [],
      activity: [],
    }),
    requestOrDefault<Repo[]>("/api/repos", []),
  ]);
  const workflowBundles = await Promise.all(
    repos.map((repo) =>
      requestOrDefault<RepoWorkflowBundle | null>(`/api/repos/${repo.id}/workflows`, null),
    ),
  );
  const workflowStates = workflowBundles.flatMap((bundle) => bundle?.workflows ?? []);
  const brokeredApprovalBlocks = (
    await Promise.all(
      tasks
        .filter((task) => ["completed", "failed", "stopped", "in_progress"].includes(task.status))
        .slice(0, 8)
        .map(async (task) => {
          const gate = await requestOrDefault<ReleaseGateResponse>(
            `/api/release/task/${task.id}/gate`,
            {
              canRelease: false,
              latestRunId: null,
              brokeredContext: null,
              blockers: [],
              warnings: [],
              checks: {},
            },
          );

          const humanApprovalBlocked = gate.blockers.includes("Human approval required");
          const brokeredRisk = gate.brokeredContext?.riskLevel ?? "unknown";
          const brokeredApprovalRequired =
            gate.brokeredContext?.trustBoundaries?.requiresHumanApproval === true;

          return humanApprovalBlocked && (brokeredApprovalRequired || brokeredRisk !== "low");
        }),
    )
  ).filter(Boolean).length;
  const scanEscalatedApprovalBlocks = (
    await Promise.all(
      tasks
        .filter((task) => ["completed", "failed", "stopped", "in_progress"].includes(task.status))
        .slice(0, 8)
        .map(async (task) => {
          const gate = await requestOrDefault<ReleaseGateResponse>(
            `/api/release/task/${task.id}/gate`,
            {
              canRelease: false,
              latestRunId: null,
              brokeredContext: null,
              blockers: [],
              warnings: [],
              checks: {},
            },
          );

          return gate.blockers.includes("Human approval required after blocking scan findings");
        }),
    )
  ).filter(Boolean).length;

  return {
    activeTasks: tasks.filter((task) =>
      ["pending", "approved", "in_progress"].includes(task.status),
    ).length,
    runningAgents: runs.filter((run) =>
      ["queued", "preparing", "running", "verifying", "reviewing", "repairing"].includes(run.status),
    ).length,
    pendingReviews: runs.filter((run) =>
      ["reviewing", "waiting_approval"].includes(run.status),
    ).length,
    evidenceRecords: evidences.length,
    failedRuns: runs.filter((run) => run.status === "failed").length,
    securityScanBlocks: runs.filter((run) => getSecurityScanBlockCount(run) > 0).length,
    runsWithRepairs: runs.filter((run) => (run._count?.repairs ?? 0) > 0).length,
    escalatedRepairs: runs.filter((run) => Boolean(run.repairs?.[0]?.escalationReason)).length,
    approvalPendingEvidence: evidences.filter((evidence) =>
      evidence.reviewSection?.humanReview === "required" ||
      evidence.reviewSection?.codeOwnerApproval === "pending",
    ).length,
    brokeredApprovalBlocks,
    scanEscalatedApprovalBlocks,
    totalScanFindings: Object.values(evidenceBundle.summary.scanFindingTotals).reduce(
      (sum, count) => sum + count,
      0,
    ),
    governanceApprovals: evidenceBundle.summary.governanceActionTotals.approved ?? 0,
    governanceRejections: evidenceBundle.summary.governanceActionTotals.rejected ?? 0,
    governanceStops: evidenceBundle.summary.governanceActionTotals.stopped ?? 0,
    prDeliveries: evidenceBundle.summary.deliveryActionTotals.github_pull_request_created ?? 0,
    reviewDeliveries: evidenceBundle.summary.deliveryActionTotals.github_review_submitted ?? 0,
    releaseDispatches: evidenceBundle.summary.deliveryActionTotals.github_release_dispatched ?? 0,
    gitWorktreeEvidence: evidenceBundle.summary.preparationModeTotals.git_worktree ?? 0,
    syntheticGitEvidence: evidenceBundle.summary.preparationModeTotals.synthetic_git ?? 0,
    workflowInstalledRepos: workflowBundles.filter(
      (bundle) => bundle && bundle.workflows.every((workflow) => workflow.installation.status === "installed"),
    ).length,
    workflowMissingCount: workflowStates.filter((workflow) => workflow.installation.status === "missing").length,
    workflowDriftedCount: workflowStates.filter((workflow) => workflow.installation.status === "drifted").length,
    workflowUnknownCount: workflowStates.filter((workflow) => workflow.installation.status === "unknown").length,
  };
}
