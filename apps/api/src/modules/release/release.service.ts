import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient, type RunStatus } from '@prisma/client';
import type { ActionActor } from '../access/action-actor.js';
import { WorkflowGeneratorService } from '../repo/workflow-generator.service.js';
import { ReviewGateService } from '../review/review-gate.service.js';
import { ConfigService } from '../../config/configuration.js';

const prisma = new PrismaClient();

type GateCheck = {
  passed: boolean;
  required: boolean;
  detail: string;
};

type ReleasePlan = {
  taskId: string;
  repo: string | null;
  sourceSha: string | null;
  baseBranch: string | null;
  headBranch: string | null;
  compareUrl: string | null;
  brokeredContext: BrokeredContextData | null;
  deliveryActions: Array<Record<string, unknown>>;
  githubDispatch: {
    ready: boolean;
    workflow: string;
    workflowPath: string;
    actionsUrl: string | null;
    dispatchUrl: string | null;
  };
  releaseNotes: string;
  rollbackPlan: string[];
  deploymentRecommendation: 'ready' | 'blocked';
  blockers: string[];
  warnings: string[];
};

type BrokeredContextData = {
  riskLevel?: string;
  trustBoundaries?: {
    requiresHumanApproval?: boolean;
  };
};

type ScanSummary = {
  checkName: string;
  label: string;
  status: 'passed' | 'failed' | 'skipped' | 'unknown';
};

type ScanFindingSummary = {
  checkName: string;
  label: string;
  count: number;
  samples: string[];
};

@Injectable()
export class ReleaseService {
  private readonly releaseWorkflow = 'ai-release.yml';

  constructor(
    private readonly reviewGateService: ReviewGateService,
    private readonly config: ConfigService,
    private readonly workflowGenerator: WorkflowGeneratorService,
  ) {}

  async evaluateGate(taskId: string): Promise<{
    canRelease: boolean;
    checks: Record<string, GateCheck>;
    blockers: string[];
    warnings: string[];
    latestRunId: string | null;
    brokeredContext: BrokeredContextData | null;
  }> {
    const task = await prisma.agentTask.findUnique({
      where: { id: taskId },
      include: {
        repo: true,
        approvals: {
          orderBy: { createdAt: 'desc' },
        },
        runs: {
          orderBy: { createdAt: 'desc' },
          include: {
            events: {
              orderBy: { timestamp: 'asc' },
            },
            repairs: {
              orderBy: { loopNumber: 'desc' },
            },
            reviews: {
              orderBy: { reviewedAt: 'desc' },
            },
          },
        },
        evidences: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!task) {
      throw new NotFoundException(`Task not found: ${taskId}`);
    }

    const latestRun = task.runs[0] ?? null;
    const reviewGate = latestRun
      ? await this.reviewGateService.evaluate(taskId, latestRun.id)
      : { canMerge: false, blockers: ['No run available for release evaluation'], warnings: [] };
    const githubRepoConnected = Boolean(task.repo?.fullName) && Boolean(task.repo?.url);
    const repoWorkflowDefinitions = task.repo
      ? await this.workflowGenerator.inspectWorkflowDefinitions(task.repo.localPath)
      : [];
    const releaseWorkflowDefinition = repoWorkflowDefinitions.find(
      (workflow) => workflow.filename === this.releaseWorkflow,
    );

    const blockers = [...reviewGate.blockers];
    const warnings = [...reviewGate.warnings];
    const checks: Record<string, GateCheck> = {};
    const brokeredContext = latestRun ? this.getBrokeredContext(latestRun.events) : null;
    const effectiveRiskLevel = brokeredContext?.riskLevel ?? task.riskLevel;

    const completedRuns = task.runs.filter((run) => run.status === 'completed');
    checks['completed_run_exists'] = {
      passed: completedRuns.length > 0,
      required: true,
      detail:
        completedRuns.length > 0
          ? `${completedRuns.length} completed run(s) recorded.`
          : 'No completed run is available for release.',
    };
    if (completedRuns.length === 0) {
      blockers.push('No completed runs');
    }

    checks['latest_run_completed'] = {
      passed: latestRun?.status === 'completed',
      required: true,
      detail: latestRun ? `Latest run status is ${latestRun.status}.` : 'No latest run found.',
    };
    if (latestRun && latestRun.status !== 'completed') {
      blockers.push(`Latest run must complete successfully before release (current: ${latestRun.status})`);
    }

    const latestVerification = latestRun ? this.getLatestEventData(latestRun.events, 'verification_completed') : null;
    const verificationPassed = latestVerification?.passed === true;
    const scanSummaries = this.getScanSummaries(latestVerification);
    const scanFindingSummaries = this.getScanFindingSummaries(latestVerification);
    const hasBlockingScanFailure = scanSummaries.some((scan) => scan.status === 'failed');
    const requiresHumanApproval =
      (brokeredContext?.trustBoundaries?.requiresHumanApproval ?? task.requiresHumanApproval) ||
      hasBlockingScanFailure;
    checks['verification_passed'] = {
      passed: verificationPassed,
      required: true,
      detail: verificationPassed
        ? 'Verification completed successfully.'
        : latestRun
          ? 'Latest run does not have a passing verification result.'
          : 'No verification result found.',
    };
    if (!verificationPassed) {
      blockers.push('Verification must pass before release');
    }

    const scanChecks = [
      {
        checkName: 'secret_scan',
        gateName: 'secret_scan_clear',
        blocker: 'Secret scan must pass before release',
        label: 'Secret scan',
      },
      {
        checkName: 'sast_scan',
        gateName: 'sast_scan_clear',
        blocker: 'SAST scan must pass before release',
        label: 'SAST scan',
      },
      {
        checkName: 'dependency_scan',
        gateName: 'dependency_scan_clear',
        blocker: 'Dependency scan must pass before release',
        label: 'Dependency scan',
      },
      {
        checkName: 'license_scan',
        gateName: 'license_scan_clear',
        blocker: 'License scan must pass before release',
        label: 'License scan',
      },
    ] as const;

    for (const scanCheck of scanChecks) {
      const status = this.getVerificationCheckStatus(latestVerification, scanCheck.checkName);
      const failed = status === 'failed';
      const unknown = status === null;

      checks[scanCheck.gateName] = {
        passed: !failed,
        required: true,
        detail: unknown
          ? `${scanCheck.label} result is not available on the latest run.`
          : `${scanCheck.label} status: ${status}.`,
      };

      if (failed) {
        blockers.push(scanCheck.blocker);
        warnings.push(`${scanCheck.label} flagged the latest run.`);
        const findingSummary = scanFindingSummaries.find((summary) => summary.checkName === scanCheck.checkName);
        if (findingSummary && findingSummary.count > 0) {
          warnings.push(
            `${scanCheck.label} findings: ${findingSummary.count} (${findingSummary.samples.join('; ')})`,
          );
        }
      } else if (unknown && latestRun) {
        warnings.push(`${scanCheck.label} result was not recorded on the latest run.`);
      }
    }

    const latestReview = latestRun?.reviews[0] ?? null;
    const reviewVerdict = latestReview?.verdict ?? null;
    const reviewApproved = reviewVerdict === 'approved' || reviewVerdict === 'requires_human_review';
    checks['review_ready'] = {
      passed: reviewApproved,
      required: true,
      detail: reviewVerdict ? `Latest AI review verdict: ${reviewVerdict}.` : 'No AI review result found.',
    };
    if (!reviewApproved) {
      blockers.push('AI review must complete before release');
    }

    checks['review_gate_clear'] = {
      passed: reviewGate.canMerge,
      required: true,
      detail: reviewGate.canMerge
        ? 'No blocking review gate findings remain.'
        : reviewGate.blockers.join('; ') || 'Review gate has unresolved blockers.',
    };

    const latestEvidence = task.evidences.find((evidence) => evidence.status === 'complete') ?? task.evidences[0] ?? null;
    checks['evidence_complete'] = {
      passed: latestEvidence?.status === 'complete',
      required: true,
      detail: latestEvidence
        ? `Latest evidence status is ${latestEvidence.status}.`
        : 'No evidence record found.',
    };
    if (!latestEvidence || latestEvidence.status !== 'complete') {
      blockers.push('Evidence must be generated');
    }

    const humanApprovalRequired = requiresHumanApproval || effectiveRiskLevel !== 'low';
    const approved = task.approvals.some((approval) => approval.action === 'approved');
    checks['approval_received'] = {
      passed: !humanApprovalRequired || approved,
      required: humanApprovalRequired,
      detail: humanApprovalRequired
        ? approved
          ? 'Required human approval is recorded.'
          : hasBlockingScanFailure
            ? 'Required human approval is still missing after blocking scan findings.'
            : 'Required human approval is still missing.'
        : 'Human approval is waived for this task.',
    };
    if (humanApprovalRequired && !approved) {
      blockers.push(
        hasBlockingScanFailure
          ? 'Human approval required after blocking scan findings'
          : 'Human approval required',
      );
    }

    const latestRepair = latestRun?.repairs[0] ?? null;
    const repairEscalated = Boolean(latestRepair?.escalationReason);
    checks['repair_not_escalated'] = {
      passed: !repairEscalated,
      required: false,
      detail: latestRepair
        ? repairEscalated
          ? `Latest repair escalated: ${latestRepair.escalationReason}`
          : `Latest repair loop ${latestRepair.loopNumber} completed without escalation.`
        : 'No repair loop was needed.',
    };
    if (repairEscalated) {
      warnings.push(`Repair escalation recorded: ${latestRepair?.escalationReason}`);
    }

    checks['release_notes_ready'] = {
      passed: true,
      required: true,
      detail: 'Release notes can be generated from the latest completed run.',
    };
    checks['rollback_plan_ready'] = {
      passed: latestRun !== null,
      required: true,
      detail: latestRun
        ? 'Rollback plan can be generated from the latest run metadata.'
        : 'Rollback plan cannot be generated without a run.',
    };
    if (!latestRun) {
      blockers.push('Rollback plan requires at least one run');
    }

    checks['github_repo_connected'] = {
      passed: githubRepoConnected,
      required: true,
      detail: githubRepoConnected
        ? `GitHub repository is connected as ${task.repo?.fullName}.`
        : 'Task repository is not configured for GitHub release dispatch.',
    };
    if (!githubRepoConnected) {
      blockers.push('GitHub repository connection is required for release dispatch');
    }

    checks['github_release_workflow_declared'] = {
      passed: true,
      required: true,
      detail: `Release dispatch targets .github/workflows/${this.releaseWorkflow}.`,
    };

    const workflowInstallationStatus = releaseWorkflowDefinition?.installation.status ?? 'unknown';
    checks['github_release_workflow_installed'] = {
      passed: workflowInstallationStatus === 'installed',
      required: true,
      detail:
        releaseWorkflowDefinition?.installation.detail ??
        'Release workflow installation could not be verified.',
    };
    if (workflowInstallationStatus === 'missing') {
      blockers.push(`Release workflow ${this.releaseWorkflow} is missing from the connected checkout`);
    } else if (workflowInstallationStatus === 'drifted') {
      blockers.push(`Release workflow ${this.releaseWorkflow} has drifted from the generated template`);
    } else if (workflowInstallationStatus === 'unknown') {
      warnings.push(`Release workflow ${this.releaseWorkflow} could not be locally verified.`);
    }

    checks['github_token_configured'] = {
      passed: Boolean(this.config.githubToken),
      required: true,
      detail: this.config.githubToken
        ? 'GITHUB_TOKEN is configured for release dispatch.'
        : 'GITHUB_TOKEN is not configured for release dispatch.',
    };
    if (!this.config.githubToken) {
      blockers.push('GitHub token is required for release dispatch');
    }

    return {
      canRelease: blockers.length === 0,
      checks,
      blockers: this.unique(blockers),
      warnings: this.unique(warnings),
      latestRunId: latestRun?.id ?? null,
      brokeredContext,
    };
  }

  async generateReleasePlan(taskId: string): Promise<ReleasePlan> {
    const gate = await this.evaluateGate(taskId);
    const task = await prisma.agentTask.findUnique({
      where: { id: taskId },
      include: {
        repo: true,
        runs: {
          orderBy: { createdAt: 'desc' },
          include: {
            events: {
              orderBy: { timestamp: 'asc' },
            },
            reviews: {
              orderBy: { reviewedAt: 'desc' },
            },
          },
        },
      },
    });

    if (!task) {
      throw new NotFoundException(`Task not found: ${taskId}`);
    }

    const latestRun = task.runs[0] ?? null;
    const review = latestRun?.reviews[0] ?? null;
    const sourceSha = latestRun?.commitSha ?? null;
    const headBranch = latestRun?.branch ?? null;
    const baseBranch = task.repo?.defaultBranch ?? null;
    const brokeredContext = latestRun ? this.getBrokeredContext(latestRun.events ?? []) : null;
    const effectiveRiskLevel = brokeredContext?.riskLevel ?? task.riskLevel;
    const latestVerification = latestRun ? this.getLatestEventData(latestRun.events ?? [], 'verification_completed') : null;
    const deliveryActions = latestRun ? this.getDeliveryActions(latestRun.events ?? []) : [];
    const compareUrl =
      task.repo?.url && baseBranch && headBranch
        ? `${task.repo.url.replace(/\/$/, '')}/compare/${encodeURIComponent(baseBranch)}...${encodeURIComponent(headBranch)}?expand=1`
        : null;
    const actionsUrl = task.repo?.fullName
      ? `https://github.com/${task.repo.fullName}/actions/workflows/${this.releaseWorkflow}`
      : null;
    const dispatchUrl = task.repo?.fullName
      ? `${this.config.githubApiUrl}/repos/${task.repo.fullName}/actions/workflows/${this.releaseWorkflow}/dispatches`
      : null;

    return {
      taskId,
      repo: task.repo?.fullName ?? null,
      sourceSha,
      baseBranch,
      headBranch,
      compareUrl,
      brokeredContext,
      deliveryActions,
      githubDispatch: {
        ready: gate.canRelease,
        workflow: this.releaseWorkflow,
        workflowPath: `.github/workflows/${this.releaseWorkflow}`,
        actionsUrl,
        dispatchUrl,
      },
      releaseNotes: this.composeReleaseNotes({
        goal: task.goal,
        riskLevel: effectiveRiskLevel,
        run: latestRun,
        reviewSummary: review?.summary ?? null,
        scanSummaries: this.getScanSummaries(latestVerification),
        scanFindingSummaries: this.getScanFindingSummaries(latestVerification),
      }),
      rollbackPlan: this.composeRollbackPlan({
        repoUrl: task.repo?.url ?? null,
        baseBranch,
        headBranch,
        sourceSha,
        latestRunStatus: latestRun?.status ?? null,
      }),
      deploymentRecommendation: gate.canRelease ? 'ready' : 'blocked',
      blockers: gate.blockers,
      warnings: gate.warnings,
    };
  }

  async generateReleaseNotes(taskId: string): Promise<{ notes: string }> {
    const plan = await this.generateReleasePlan(taskId);
    return { notes: plan.releaseNotes };
  }

  async dispatchGithubRelease(taskId: string, actor?: ActionActor): Promise<Record<string, unknown>> {
    const [gate, plan] = await Promise.all([
      this.evaluateGate(taskId),
      this.generateReleasePlan(taskId),
    ]);

    if (!plan.repo) {
      throw new NotFoundException(`Repository not found for task: ${taskId}`);
    }
    if (!gate.canRelease) {
      throw new BadRequestException(
        `Release gate is blocked: ${gate.blockers.join('; ') || 'unknown blockers'}`,
      );
    }
    if (!this.config.githubToken) {
      throw new BadRequestException('GITHUB_TOKEN is not configured.');
    }

    const ref = plan.baseBranch ?? 'main';
    const response = await fetch(
      `${this.config.githubApiUrl}/repos/${plan.repo}/actions/workflows/${this.releaseWorkflow}/dispatches`,
      {
        method: 'POST',
        headers: this.getGithubHeaders(),
        body: JSON.stringify({
          ref,
          inputs: {
            task_id: taskId,
          },
        }),
      },
    );

    if (!response.ok) {
      throw new BadRequestException(await this.readGithubError(response));
    }

    if (gate.latestRunId) {
      await prisma.agentEventRecord.create({
        data: {
          runId: gate.latestRunId,
          type: 'github_release_dispatched',
          data: {
            workflow: this.releaseWorkflow,
            workflowPath: `.github/workflows/${this.releaseWorkflow}`,
            taskId,
            repo: plan.repo,
            ref,
            actionsUrl: `https://github.com/${plan.repo}/actions/workflows/${this.releaseWorkflow}`,
            actor,
          } as any,
        },
      });
    }

    return {
      taskId,
      dispatched: true,
      workflow: this.releaseWorkflow,
      workflowPath: `.github/workflows/${this.releaseWorkflow}`,
      repo: plan.repo,
      ref,
      actionsUrl: `https://github.com/${plan.repo}/actions/workflows/${this.releaseWorkflow}`,
      actor: actor ?? null,
    };
  }

  async syncGithubReleaseStatus(taskId: string, actor?: ActionActor): Promise<Record<string, unknown>> {
    const task = await prisma.agentTask.findUnique({
      where: { id: taskId },
      include: {
        repo: true,
        runs: {
          orderBy: { createdAt: 'desc' },
          include: {
            events: {
              orderBy: { timestamp: 'asc' },
            },
          },
        },
      },
    });

    if (!task) {
      throw new NotFoundException(`Task not found: ${taskId}`);
    }
    if (!task.repo?.fullName) {
      throw new NotFoundException(`Repository not found for task: ${taskId}`);
    }
    if (!this.config.githubToken) {
      throw new BadRequestException('GITHUB_TOKEN is not configured.');
    }

    const latestRun = task.runs[0] ?? null;
    if (!latestRun) {
      throw new BadRequestException('No run is available for release status sync.');
    }

    const dispatchedEvent = [...latestRun.events]
      .reverse()
      .find((event) => event.type === 'github_release_dispatched');
    if (!dispatchedEvent) {
      throw new BadRequestException('No GitHub release dispatch record was found for this task.');
    }

    const dispatchedData =
      dispatchedEvent.data && typeof dispatchedEvent.data === 'object'
        ? (dispatchedEvent.data as Record<string, unknown>)
        : {};
    const workflow =
      typeof dispatchedData.workflow === 'string' ? dispatchedData.workflow : this.releaseWorkflow;
    const ref =
      typeof dispatchedData.ref === 'string'
        ? dispatchedData.ref
        : latestRun.branch ?? task.repo.defaultBranch ?? 'main';

    const response = await fetch(
      `${this.config.githubApiUrl}/repos/${task.repo.fullName}/actions/workflows/${workflow}/runs?event=workflow_dispatch&branch=${encodeURIComponent(ref)}&per_page=20`,
      {
        method: 'GET',
        headers: this.getGithubHeaders(),
      },
    );

    if (!response.ok) {
      throw new BadRequestException(await this.readGithubError(response));
    }

    const payload = (await response.json()) as {
      workflow_runs?: Array<Record<string, unknown>>;
    };
    const workflowRuns = Array.isArray(payload.workflow_runs) ? payload.workflow_runs : [];
    const dispatchedAt = new Date(dispatchedEvent.timestamp).getTime();
    const matchedRun =
      workflowRuns.find((run) => {
        const createdAt = typeof run.created_at === 'string' ? new Date(run.created_at).getTime() : 0;
        const headBranch = typeof run.head_branch === 'string' ? run.head_branch : null;
        return headBranch === ref && createdAt >= dispatchedAt - 5 * 60 * 1000;
      }) ?? null;

    if (!matchedRun) {
      return {
        taskId,
        synced: false,
        found: false,
        workflow,
        repo: task.repo.fullName,
        ref,
        actionsUrl:
          typeof dispatchedData.actionsUrl === 'string'
            ? dispatchedData.actionsUrl
            : `https://github.com/${task.repo.fullName}/actions/workflows/${workflow}`,
      };
    }

    const syncData = {
      workflow,
      taskId,
      repo: task.repo.fullName,
      ref,
      workflowRunId: typeof matchedRun.id === 'number' ? matchedRun.id : null,
      runNumber: typeof matchedRun.run_number === 'number' ? matchedRun.run_number : null,
      status: typeof matchedRun.status === 'string' ? matchedRun.status : 'unknown',
      conclusion: typeof matchedRun.conclusion === 'string' ? matchedRun.conclusion : null,
      htmlUrl: typeof matchedRun.html_url === 'string' ? matchedRun.html_url : null,
      createdAt: typeof matchedRun.created_at === 'string' ? matchedRun.created_at : null,
      updatedAt: typeof matchedRun.updated_at === 'string' ? matchedRun.updated_at : null,
      actor: actor ?? null,
    };

    const latestStatusEvent = [...latestRun.events]
      .reverse()
      .find((event) => event.type === 'github_release_status_synced');
    const latestStatusData =
      latestStatusEvent?.data && typeof latestStatusEvent.data === 'object'
        ? (latestStatusEvent.data as Record<string, unknown>)
        : null;
    const unchanged =
      latestStatusData &&
      latestStatusData.workflowRunId === syncData.workflowRunId &&
      latestStatusData.status === syncData.status &&
      latestStatusData.conclusion === syncData.conclusion &&
      latestStatusData.htmlUrl === syncData.htmlUrl;

    if (!unchanged) {
      await prisma.agentEventRecord.create({
        data: {
          runId: latestRun.id,
          type: 'github_release_status_synced',
          data: syncData as any,
        },
      });
    }

    return {
      synced: true,
      found: true,
      unchanged: Boolean(unchanged),
      ...syncData,
    };
  }

  private getLatestEventData(
    events: Array<{ type: string; data: unknown }>,
    type: string,
  ): Record<string, unknown> | null {
    const match = [...events].reverse().find((event) => event.type === type);
    return match && match.data && typeof match.data === 'object'
      ? (match.data as Record<string, unknown>)
      : null;
  }

  private getBrokeredContext(events: Array<{ type: string; data: unknown }>): BrokeredContextData | null {
    const match = [...events].reverse().find((event) => event.type === 'context_brokered');
    return match && match.data && typeof match.data === 'object'
      ? (match.data as BrokeredContextData)
      : null;
  }

  private getDeliveryActions(events: Array<{ type: string; data: unknown }>): Array<Record<string, unknown>> {
    return events
      .filter((event) =>
        [
          'github_pull_request_created',
          'github_review_submitted',
          'github_release_dispatched',
          'github_release_status_synced',
        ].includes(
          event.type,
        ),
      )
      .map((event) => {
        const data = event.data && typeof event.data === 'object' ? (event.data as Record<string, unknown>) : {};
        return {
          type: event.type,
          actor: data.actor && typeof data.actor === 'object' ? data.actor : null,
          timestamp:
            data.timestamp ??
            (typeof (event as { timestamp?: unknown }).timestamp === 'string'
              ? (event as { timestamp?: string }).timestamp
              : null),
          status: typeof data.status === 'string' ? data.status : null,
          conclusion: typeof data.conclusion === 'string' ? data.conclusion : null,
          workflowRunId: typeof data.workflowRunId === 'number' ? data.workflowRunId : null,
          targetUrl:
            typeof data.pullRequestUrl === 'string'
              ? data.pullRequestUrl
              : typeof data.reviewUrl === 'string'
                ? data.reviewUrl
                : typeof data.htmlUrl === 'string'
                  ? data.htmlUrl
                : typeof data.actionsUrl === 'string'
                  ? data.actionsUrl
                  : null,
        };
      });
  }

  private getVerificationCheckStatus(
    verification: Record<string, unknown> | null,
    checkName: string,
  ): 'passed' | 'failed' | 'skipped' | null {
    const checks =
      verification?.checks && typeof verification.checks === 'object'
        ? (verification.checks as Record<string, unknown>)
        : null;
    const status = checks?.[checkName];
    return status === 'passed' || status === 'failed' || status === 'skipped' ? status : null;
  }

  private getScanSummaries(verification: Record<string, unknown> | null): ScanSummary[] {
    const scanChecks = [
      { checkName: 'secret_scan', label: 'Secret scan' },
      { checkName: 'sast_scan', label: 'SAST scan' },
      { checkName: 'dependency_scan', label: 'Dependency scan' },
      { checkName: 'license_scan', label: 'License scan' },
    ] as const;

    return scanChecks.map((scanCheck) => ({
      checkName: scanCheck.checkName,
      label: scanCheck.label,
      status: this.getVerificationCheckStatus(verification, scanCheck.checkName) ?? 'unknown',
    }));
  }

  private getScanFindingSummaries(verification: Record<string, unknown> | null): ScanFindingSummary[] {
    const findingKeys = [
      { checkName: 'secret_scan', label: 'Secret scan', key: 'secretScanFindings' },
      { checkName: 'sast_scan', label: 'SAST scan', key: 'sastScanFindings' },
      { checkName: 'dependency_scan', label: 'Dependency scan', key: 'dependencyScanFindings' },
      { checkName: 'license_scan', label: 'License scan', key: 'licenseScanFindings' },
    ] as const;

    return findingKeys.map((item) => {
      const rawValue = verification?.[item.key];
      const findings = Array.isArray(rawValue) ? rawValue : [];
      const samples = findings
        .map((entry) => {
          if (!entry || typeof entry !== 'object') {
            return '';
          }
          const record = entry as Record<string, unknown>;
          const type = typeof record.type === 'string' ? record.type : 'unknown';
          return type;
        })
        .filter(Boolean)
        .slice(0, 3);

      return {
        checkName: item.checkName,
        label: item.label,
        count: findings.length,
        samples,
      };
    });
  }

  private composeReleaseNotes(input: {
    goal: string;
    riskLevel: string;
    run: {
      id: string;
      agentName: string;
      filesChanged: string[];
      commandsRun: string[];
      status: RunStatus;
    } | null;
    reviewSummary: string | null;
    scanSummaries: ScanSummary[];
    scanFindingSummaries: ScanFindingSummary[];
  }): string {
    const changedFiles =
      input.run?.filesChanged.length
        ? input.run.filesChanged.map((file) => `- ${file}`).join('\n')
        : '- No file changes recorded';
    const commands =
      input.run?.commandsRun.length
        ? input.run.commandsRun.map((command) => `- ${command}`).join('\n')
        : '- No commands recorded';
    const scanSummary =
      input.scanSummaries.length > 0
        ? input.scanSummaries.map((scan) => `- ${scan.label}: ${scan.status}`).join('\n')
        : '- No scan results recorded';
    const scanFindings =
      input.scanFindingSummaries.some((scan) => scan.count > 0)
        ? input.scanFindingSummaries
            .filter((scan) => scan.count > 0)
            .map((scan) => `- ${scan.label}: ${scan.count} finding(s)${scan.samples.length > 0 ? ` [${scan.samples.join(', ')}]` : ''}`)
            .join('\n')
        : '- No scan findings recorded';

    return [
      '## AI Release Summary',
      '',
      `Task: ${input.goal}`,
      `Risk level: ${input.riskLevel}`,
      `Latest run: ${input.run?.id ?? 'none'} (${input.run?.status ?? 'unknown'})`,
      `Agent: ${input.run?.agentName ?? 'unknown'}`,
      '',
      '### Changed Files',
      changedFiles,
      '',
      '### Verification Commands',
      commands,
      '',
      '### Scan Summary',
      scanSummary,
      '',
      '### Scan Findings',
      scanFindings,
      '',
      '### Review Summary',
      input.reviewSummary ?? 'No review summary recorded.',
    ].join('\n');
  }

  private composeRollbackPlan(input: {
    repoUrl: string | null;
    baseBranch: string | null;
    headBranch: string | null;
    sourceSha: string | null;
    latestRunStatus: RunStatus | null;
  }): string[] {
    const steps = [
      'Pause rollout and keep production environment protection enabled.',
      input.headBranch && input.baseBranch
        ? `Revert the AI branch by comparing ${input.baseBranch} against ${input.headBranch} and preparing a revert PR.`
        : 'Prepare a revert PR from the last known good branch state.',
      input.sourceSha
        ? `Reset deployment target to source SHA ${input.sourceSha} if the release has already been promoted.`
        : 'Reset deployment target to the last known good commit if release artifacts were promoted.',
      'Re-run verification and confirm review blockers are cleared before retrying release.',
    ];

    if (input.repoUrl && input.baseBranch && input.headBranch) {
      steps.splice(
        1,
        0,
        `Use compare view ${input.repoUrl.replace(/\/$/, '')}/compare/${encodeURIComponent(input.baseBranch)}...${encodeURIComponent(input.headBranch)}?expand=1 to inspect the rollback scope.`,
      );
    }

    if (input.latestRunStatus && input.latestRunStatus !== 'completed') {
      steps.push(`Latest run status was ${input.latestRunStatus}; investigate pipeline instability before redeploying.`);
    }

    return steps;
  }

  private unique(values: string[]): string[] {
    return [...new Set(values)];
  }

  private getGithubHeaders() {
    return {
      Authorization: `Bearer ${this.config.githubToken}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'aicp-control-plane',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  private async readGithubError(response: Response) {
    try {
      const payload = (await response.json()) as { message?: string };
      if (payload?.message) {
        return `GitHub API error: ${payload.message}`;
      }
    } catch {
      return `GitHub API error: ${response.status} ${response.statusText}`;
    }

    return `GitHub API error: ${response.status} ${response.statusText}`;
  }
}
