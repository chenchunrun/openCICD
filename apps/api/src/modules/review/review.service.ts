import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient, type ReviewVerdict } from '@prisma/client';
import { matchAnyGlob, type ReviewFinding } from '@aicp/shared';
import { AgentRegistryService } from '../agent/agent-registry.service.js';
import { ConfigService } from '../../config/configuration.js';

const prisma = new PrismaClient();

type VerificationEventData = {
  passed?: boolean;
  checks?: Record<string, unknown>;
  testWeakeningDetected?: boolean;
};

type BrokeredContextEventData = {
  riskLevel?: string;
  scope?: {
    allowedPaths?: string[];
    forbiddenPaths?: string[];
  };
  trustBoundaries?: {
    requiresHumanApproval?: boolean;
  };
};

type ReviewDraftAction = 'COMMENT' | 'REQUEST_CHANGES';

type ReviewDraft = {
  action: ReviewDraftAction;
  body: string;
  comments: Array<{
    path: string;
    line?: number;
    body: string;
    severity: ReviewFinding['severity'];
    category: ReviewFinding['category'];
  }>;
};

type PullRequestDraftData = {
  title: string | null;
  body: string | null;
  baseBranch: string | null;
  headBranch: string | null;
  compareUrl: string | null;
  pullRequestUrl: string | null;
};

@Injectable()
export class ReviewService {
  constructor(
    private readonly agentRegistry: AgentRegistryService,
    private readonly config: ConfigService,
  ) {}

  async performReview(runId: string, generatingAgent: string): Promise<Record<string, unknown>> {
    const reviewAgent = this.agentRegistry.getAlternativeAgent(generatingAgent);
    if (!reviewAgent) {
      throw new Error('No alternative agent available for review');
    }

    const run = await prisma.agentRun.findUnique({
      where: { id: runId },
      include: {
        task: {
          include: {
            repo: true,
          },
        },
        events: {
          orderBy: { timestamp: 'asc' },
        },
      },
    });
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }

    const findings = this.buildFindings(run);
    const verdict = this.decideVerdict(run, findings);
    const summary = this.buildSummary(verdict, findings);
    const prReviewDraft = this.buildPullRequestReviewDraft(verdict, summary, findings);

    const review = await prisma.reviewResultRecord.create({
      data: {
        runId,
        agentName: reviewAgent.config.name,
        summary,
        findings: findings as any,
        verdict,
      },
    });

    return {
      ...review,
      suggestedAction: prReviewDraft.action,
      reviewBody: prReviewDraft.body,
      reviewComments: prReviewDraft.comments,
    };
  }

  async getReviewsForRun(runId: string) {
    return prisma.reviewResultRecord.findMany({
      where: { runId },
      orderBy: { reviewedAt: 'desc' },
    });
  }

  async getPullRequestDraft(runId: string): Promise<Record<string, unknown>> {
    const run = await this.getRunWithDraftContext(runId);
    const prDraftData = this.extractPullRequestDraft(run);

    const latestReview = run.reviews[0];
    if (!latestReview) {
      return {
        runId,
        available: false,
        reason: 'No review result has been generated for this run.',
      };
    }

    const findings = Array.isArray(latestReview.findings)
      ? (latestReview.findings as unknown as ReviewFinding[])
      : [];
    const draft = this.buildPullRequestReviewDraft(
      latestReview.verdict,
      latestReview.summary,
      findings,
    );

    return {
      runId,
      available: true,
      action: draft.action,
      body: draft.body,
      comments: draft.comments,
      review: {
        agentName: latestReview.agentName,
        verdict: latestReview.verdict,
        summary: latestReview.summary,
        reviewedAt: latestReview.reviewedAt,
      },
      pullRequest: prDraftData,
    };
  }

  async getGithubPullRequestPayload(runId: string): Promise<Record<string, unknown>> {
    const run = await this.getRunWithDraftContext(runId);
    const prDraftData = this.extractPullRequestDraft(run);

    if (!prDraftData.title || !prDraftData.headBranch || !prDraftData.baseBranch) {
      return {
        runId,
        available: false,
        reason: 'No pull request draft has been generated for this run.',
      };
    }

    return {
      runId,
      available: true,
      github: {
        title: prDraftData.title,
        body: prDraftData.body ?? '',
        head: prDraftData.headBranch,
        base: prDraftData.baseBranch,
        draft: true,
        maintainer_can_modify: false,
      },
      metadata: {
        compareUrl: prDraftData.compareUrl,
        pullRequestUrl: prDraftData.pullRequestUrl,
      },
    };
  }

  async getGithubReviewPayload(runId: string): Promise<Record<string, unknown>> {
    const run = await this.getRunWithDraftContext(runId);
    const latestReview = run.reviews[0];
    if (!latestReview) {
      return {
        runId,
        available: false,
        reason: 'No review result has been generated for this run.',
      };
    }

    const findings = Array.isArray(latestReview.findings)
      ? (latestReview.findings as unknown as ReviewFinding[])
      : [];
    const draft = this.buildPullRequestReviewDraft(
      latestReview.verdict,
      latestReview.summary,
      findings,
    );
    const prDraftData = this.extractPullRequestDraft(run);

    return {
      runId,
      available: true,
      github: {
        event: draft.action,
        body: draft.body,
        comments: draft.comments.map((comment) => ({
          path: comment.path,
          ...(comment.line ? { line: comment.line } : {}),
          side: 'RIGHT',
          body: comment.body,
        })),
        ...(run.commitSha ? { commit_id: run.commitSha } : {}),
      },
      metadata: {
        pullRequest: prDraftData,
        verdict: latestReview.verdict,
        agentName: latestReview.agentName,
        reviewedAt: latestReview.reviewedAt,
      },
    };
  }

  async createGithubPullRequest(runId: string): Promise<Record<string, unknown>> {
    const payload = await this.getGithubPullRequestPayload(runId);
    if (!payload.available || !payload.github) {
      throw new BadRequestException(payload.reason ?? 'No pull request payload is available.');
    }

    const run = await prisma.agentRun.findUnique({
      where: { id: runId },
      include: {
        task: {
          include: {
            repo: true,
          },
        },
      },
    });
    if (!run) {
      throw new NotFoundException(`Run not found: ${runId}`);
    }
    if (!run.task.repo) {
      throw new BadRequestException('Repository context is missing for this run.');
    }
    if (!this.config.githubToken) {
      throw new BadRequestException('GITHUB_TOKEN is not configured.');
    }
    if (run.pullRequestUrl) {
      return {
        runId,
        created: false,
        alreadyExists: true,
        pullRequestUrl: run.pullRequestUrl,
      };
    }

    const response = await fetch(
      `${this.config.githubApiUrl}/repos/${run.task.repo.fullName}/pulls`,
      {
        method: 'POST',
        headers: this.getGithubHeaders(),
        body: JSON.stringify(payload.github),
      },
    );

    if (!response.ok) {
      throw new BadRequestException(await this.readGithubError(response));
    }

    const createdPr = (await response.json()) as {
      html_url?: string;
      number?: number;
      state?: string;
    };
    const pullRequestUrl = createdPr.html_url ?? null;

    await prisma.agentRun.update({
      where: { id: runId },
      data: {
        pullRequestUrl,
      },
    });

    await prisma.agentEventRecord.create({
      data: {
        runId,
        type: 'github_pull_request_created',
        data: {
          pullRequestUrl,
          number: createdPr.number ?? null,
          state: createdPr.state ?? null,
        } as any,
      },
    });

    return {
      runId,
      created: true,
      pullRequestUrl,
      number: createdPr.number ?? null,
      state: createdPr.state ?? null,
    };
  }

  async submitGithubReview(runId: string): Promise<Record<string, unknown>> {
    const payload = await this.getGithubReviewPayload(runId);
    if (!payload.available || !payload.github) {
      throw new BadRequestException(payload.reason ?? 'No GitHub review payload is available.');
    }
    const githubPayload = payload.github as {
      event?: string;
      body?: string;
      comments?: Array<Record<string, unknown>>;
      commit_id?: string;
    };

    const run = await prisma.agentRun.findUnique({
      where: { id: runId },
      include: {
        task: {
          include: {
            repo: true,
          },
        },
      },
    });
    if (!run) {
      throw new NotFoundException(`Run not found: ${runId}`);
    }
    if (!run.task.repo) {
      throw new BadRequestException('Repository context is missing for this run.');
    }
    if (!run.pullRequestUrl) {
      throw new BadRequestException('No pull request URL is recorded for this run.');
    }
    if (!this.config.githubToken) {
      throw new BadRequestException('GITHUB_TOKEN is not configured.');
    }

    const pullNumber = this.parsePullRequestNumber(run.pullRequestUrl);
    if (!pullNumber) {
      throw new BadRequestException('Unable to determine pull request number from pullRequestUrl.');
    }

    const response = await fetch(
      `${this.config.githubApiUrl}/repos/${run.task.repo.fullName}/pulls/${pullNumber}/reviews`,
      {
        method: 'POST',
        headers: this.getGithubHeaders(),
        body: JSON.stringify(githubPayload),
      },
    );

    if (!response.ok) {
      throw new BadRequestException(await this.readGithubError(response));
    }

    const submittedReview = (await response.json()) as {
      id?: number;
      html_url?: string;
      state?: string;
    };

    await prisma.agentEventRecord.create({
      data: {
        runId,
        type: 'github_review_submitted',
        data: {
          reviewId: submittedReview.id ?? null,
          reviewUrl: submittedReview.html_url ?? null,
          state: submittedReview.state ?? null,
          event: githubPayload.event ?? null,
        } as any,
      },
    });

    return {
      runId,
      submitted: true,
      reviewId: submittedReview.id ?? null,
      reviewUrl: submittedReview.html_url ?? null,
      state: submittedReview.state ?? null,
    };
  }

  private async getRunWithDraftContext(runId: string) {
    const run = await prisma.agentRun.findUnique({
      where: { id: runId },
      include: {
        reviews: {
          orderBy: { reviewedAt: 'desc' },
          take: 1,
        },
        events: {
          where: {
            type: {
              in: ['pr_draft_generated', 'review_completed'],
            },
          },
          orderBy: { timestamp: 'asc' },
        },
      },
    });

    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }
    return run;
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

  private parsePullRequestNumber(pullRequestUrl: string): number | null {
    const match = pullRequestUrl.match(/\/pull\/(\d+)(?:\/|$)/);
    if (!match) {
      return null;
    }

    const number = Number.parseInt(match[1] ?? '', 10);
    return Number.isFinite(number) ? number : null;
  }

  private buildFindings(run: {
    status: string;
    filesChanged: string[];
    networkUsed: boolean;
    secretsAccessed: boolean;
    task: {
      riskLevel: string;
      requiresHumanApproval: boolean;
      repo: {
        highRiskPaths: string[];
      } | null;
    };
    events: Array<{ type: string; data: unknown }>;
  }): ReviewFinding[] {
    const findings: ReviewFinding[] = [];
    const verification = this.getVerificationEvent(run.events);
    const brokeredContext = this.getBrokeredContextEvent(run.events);
    const failedChecks = this.getFailedChecks(verification?.checks);

    if (verification?.testWeakeningDetected) {
      findings.push({
        severity: 'critical',
        category: 'test_quality',
        file: this.findFirstMatchingPath(run.filesChanged, ['**/*.test.*', '**/*.spec.*']) ?? 'tests',
        message: 'Test weakening was detected during verification.',
        recommendation: 'Restore deleted or weakened tests before merging this change.',
      });
    }

    for (const check of failedChecks) {
      findings.push(this.buildFailedCheckFinding(check, run.filesChanged[0] ?? 'repo'));
    }

    const highRiskFiles = this.filterHighRiskPaths(
      run.filesChanged,
      run.task.repo?.highRiskPaths ?? brokeredContext?.scope?.forbiddenPaths ?? [],
    );
    for (const file of highRiskFiles) {
      findings.push({
        severity: 'medium',
        category: this.categorizeHighRiskPath(file),
        file,
        message: 'Change touches a high-risk path that should be reviewed carefully.',
        recommendation: 'Require focused human review for this path before merge.',
      });
    }

    if (run.networkUsed) {
      findings.push({
        severity: 'medium',
        category: 'security',
        file: run.filesChanged[0] ?? 'repo',
        message: 'Agent execution used network access during this run.',
        recommendation: 'Confirm outbound access was expected and review affected changes.',
      });
    }

    if (run.secretsAccessed) {
      findings.push({
        severity: 'high',
        category: 'security',
        file: run.filesChanged[0] ?? 'repo',
        message: 'Agent execution accessed task-scoped secrets.',
        recommendation: 'Validate secret usage and confirm no credentials were exposed in code or logs.',
      });
    }

    if (run.status === 'stopped') {
      findings.push({
        severity: 'medium',
        category: 'rollback_feasibility',
        file: run.filesChanged[0] ?? 'repo',
        message: 'Run was stopped before the full pipeline completed.',
        recommendation: 'Re-run the task or complete manual review before merge.',
      });
    }

    return this.dedupeFindings(findings);
  }

  private decideVerdict(
    run: {
      status: string;
      task: { riskLevel: string; requiresHumanApproval: boolean };
      events?: Array<{ type: string; data: unknown }>;
    },
    findings: ReviewFinding[],
  ): ReviewVerdict {
    const brokeredContext = this.getBrokeredContextEvent(run.events ?? []);
    const effectiveRiskLevel = brokeredContext?.riskLevel ?? run.task.riskLevel;
    const requiresHumanApproval =
      brokeredContext?.trustBoundaries?.requiresHumanApproval ?? run.task.requiresHumanApproval;

    if (run.status === 'failed' || run.status === 'cancelled') {
      return 'blocked';
    }

    const hasCriticalOrHigh = findings.some((finding) => finding.severity === 'critical' || finding.severity === 'high');
    if (hasCriticalOrHigh) {
      return 'requires_changes';
    }

    const needsHumanReview =
      requiresHumanApproval ||
      effectiveRiskLevel === 'high' ||
      effectiveRiskLevel === 'critical' ||
      findings.some((finding) => finding.severity === 'medium');

    if (needsHumanReview) {
      return 'requires_human_review';
    }

    return 'approved';
  }

  private buildSummary(verdict: ReviewVerdict, findings: ReviewFinding[]): string {
    if (findings.length === 0) {
      return verdict === 'approved' ? 'No material issues detected in rule-based review.' : 'Review completed.';
    }

    const criticalOrHigh = findings.filter((finding) => finding.severity === 'critical' || finding.severity === 'high');
    if (verdict === 'requires_changes') {
      return `${criticalOrHigh.length} blocking issue(s) detected in verification or execution signals.`;
    }

    if (verdict === 'requires_human_review') {
      return `${findings.length} review consideration(s) detected; human approval is recommended.`;
    }

    if (verdict === 'blocked') {
      return 'Run state blocks automated approval.';
    }

    return `${findings.length} low-risk review note(s) recorded.`;
  }

  private getVerificationEvent(
    events: Array<{ type: string; data: unknown }>,
  ): VerificationEventData | undefined {
    const event = [...events].reverse().find((entry) => entry.type === 'verification_completed');
    if (!event || !event.data || typeof event.data !== 'object') {
      return undefined;
    }

    return event.data as VerificationEventData;
  }

  private getBrokeredContextEvent(
    events: Array<{ type: string; data: unknown }>,
  ): BrokeredContextEventData | undefined {
    const event = [...events].reverse().find((entry) => entry.type === 'context_brokered');
    if (event?.data && typeof event.data === 'object') {
      return event.data as BrokeredContextEventData;
    }

    return undefined;
  }

  private getFailedChecks(checks: Record<string, unknown> | undefined): string[] {
    if (!checks) {
      return [];
    }

    return Object.entries(checks)
      .filter(([, status]) => status === 'failed')
      .map(([name]) => name);
  }

  private buildFailedCheckFinding(checkName: string, file: string): ReviewFinding {
    switch (checkName) {
      case 'unit_tests':
        return {
          severity: 'high',
          category: 'test_quality',
          file,
          message: 'Unit tests failed during verification.',
          recommendation: 'Fix failing tests or adjust the implementation to preserve existing behavior.',
        };
      case 'typecheck':
        return {
          severity: 'high',
          category: 'api_compatibility',
          file,
          message: 'Type checking failed during verification.',
          recommendation: 'Resolve type errors before this change can be approved.',
        };
      case 'build':
        return {
          severity: 'high',
          category: 'architecture_consistency',
          file,
          message: 'Build failed during verification.',
          recommendation: 'Restore a green build before merge.',
        };
      case 'lint':
        return {
          severity: 'medium',
          category: 'architecture_consistency',
          file,
          message: 'Lint checks failed during verification.',
          recommendation: 'Address lint violations or update the change to match repository standards.',
        };
      case 'test_weakening_check':
        return {
          severity: 'critical',
          category: 'test_quality',
          file,
          message: 'Verification detected test weakening.',
          recommendation: 'Reinstate removed coverage and re-run verification.',
        };
      case 'secret_scan':
        return {
          severity: 'critical',
          category: 'security',
          file,
          message: 'Secret scan detected a credential-like value in the change set.',
          recommendation: 'Remove the secret, rotate any exposed credential, and re-run verification.',
        };
      case 'sast_scan':
        return {
          severity: 'high',
          category: 'security',
          file,
          message: 'Static analysis detected a dangerous code pattern in the change set.',
          recommendation: 'Remove or harden the unsafe pattern and re-run verification.',
        };
      case 'dependency_scan':
        return {
          severity: 'high',
          category: 'security',
          file,
          message: 'Dependency scan detected a risky package source or install hook in the change set.',
          recommendation: 'Remove the risky dependency change, review supply-chain intent, and re-run verification.',
        };
      case 'license_scan':
        return {
          severity: 'high',
          category: 'architecture_consistency',
          file,
          message: 'License scan detected a restricted or custom license declaration in the change set.',
          recommendation: 'Review license compatibility and compliance obligations before merge.',
        };
      default:
        return {
          severity: 'medium',
          category: 'logic_correctness',
          file,
          message: `${checkName} failed during verification.`,
          recommendation: 'Investigate the failing check before merge.',
        };
    }
  }

  private filterHighRiskPaths(files: string[], patterns: string[]): string[] {
    return files.filter((file) => matchAnyGlob(patterns, file));
  }

  private categorizeHighRiskPath(filePath: string): ReviewFinding['category'] {
    if (filePath.includes('migration')) {
      return 'data_migration';
    }
    if (filePath.includes('observability') || filePath.includes('monitor')) {
      return 'observability';
    }
    if (filePath.includes('api')) {
      return 'api_compatibility';
    }
    return 'security';
  }

  private findFirstMatchingPath(files: string[], patterns: string[]): string | undefined {
    return files.find((file) => matchAnyGlob(patterns, file));
  }

  private dedupeFindings(findings: ReviewFinding[]): ReviewFinding[] {
    const seen = new Set<string>();
    const result: ReviewFinding[] = [];

    for (const finding of findings) {
      const key = `${finding.severity}:${finding.category}:${finding.file}:${finding.message}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      result.push(finding);
    }

    return result;
  }

  private extractPullRequestDraft(run: {
    branch: string | null;
    pullRequestUrl: string | null;
    events: Array<{ type: string; data: unknown }>;
  }): PullRequestDraftData {
    const prDraftEvent = [...run.events].reverse().find((event) => event.type === 'pr_draft_generated');
    const prDraftData =
      prDraftEvent && prDraftEvent.data && typeof prDraftEvent.data === 'object'
        ? (prDraftEvent.data as Record<string, unknown>)
        : null;

    return {
      title: typeof prDraftData?.title === 'string' ? prDraftData.title : null,
      body: typeof prDraftData?.body === 'string' ? prDraftData.body : null,
      baseBranch: typeof prDraftData?.baseBranch === 'string' ? prDraftData.baseBranch : null,
      headBranch:
        typeof prDraftData?.headBranch === 'string'
          ? prDraftData.headBranch
          : run.branch ?? null,
      compareUrl: typeof prDraftData?.compareUrl === 'string' ? prDraftData.compareUrl : null,
      pullRequestUrl: run.pullRequestUrl ?? null,
    };
  }

  private buildPullRequestReviewDraft(
    verdict: ReviewVerdict,
    summary: string,
    findings: ReviewFinding[],
  ): ReviewDraft {
    const action: ReviewDraftAction =
      verdict === 'requires_changes' || verdict === 'blocked'
        ? 'REQUEST_CHANGES'
        : 'COMMENT';

    const body = [
      `AI review summary: ${summary}`,
      '',
      `Suggested action: ${action}`,
      ...(verdict === 'requires_human_review'
        ? ['', 'Human approval is still recommended before merge.']
        : []),
    ].join('\n');

    const comments = findings.map((finding) => ({
      path: finding.file,
      ...(finding.line ? { line: finding.line } : {}),
      body: [
        `[${finding.severity.toUpperCase()}] ${finding.category}`,
        finding.message,
        `Recommendation: ${finding.recommendation}`,
      ].join('\n'),
      severity: finding.severity,
      category: finding.category,
    }));

    return {
      action,
      body,
      comments,
    };
  }
}
