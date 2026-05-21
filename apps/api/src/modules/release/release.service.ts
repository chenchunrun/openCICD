import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient, type RunStatus } from '@prisma/client';
import { ReviewGateService } from '../review/review-gate.service.js';

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
  constructor(private readonly reviewGateService: ReviewGateService) {}

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
    const compareUrl =
      task.repo?.url && baseBranch && headBranch
        ? `${task.repo.url.replace(/\/$/, '')}/compare/${encodeURIComponent(baseBranch)}...${encodeURIComponent(headBranch)}?expand=1`
        : null;

    return {
      taskId,
      repo: task.repo?.fullName ?? null,
      sourceSha,
      baseBranch,
      headBranch,
      compareUrl,
      brokeredContext,
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
}
