import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AgentService } from '../agent/agent.service.js';
import { ContextBrokerService } from '../context/context-broker.service.js';
import { EvidenceGeneratorService } from '../evidence/evidence-generator.service.js';
import { PolicyResolverService } from '../policy/policy-resolver.service.js';
import { RepairService } from '../repair/repair.service.js';
import { RepoService } from '../repo/repo.service.js';
import { ReviewService } from '../review/review.service.js';
import { RunnerService } from '../runner/runner.service.js';
import { VerificationService } from '../verification/verification.service.js';

const prisma = new PrismaClient();

export type PipelineStage =
  | 'RESOLVE_POLICY'
  | 'PREPARE_RUN'
  | 'EXECUTE'
  | 'VERIFY'
  | 'REVIEW'
  | 'REPAIR'
  | 'EVIDENCE'
  | 'COMPLETE';

type PullRequestDraftEvent = {
  title: string;
  body: string;
  baseBranch: string;
  headBranch: string;
  compareUrl: string | null;
  sourceType: string;
  sourceUrl: string | null;
};

@Injectable()
export class OrchestratorService {
  private readonly logger = new Logger(OrchestratorService.name);
  private readonly activeTasks = new Set<string>();

  constructor(
    private readonly agentService: AgentService,
    private readonly contextBroker: ContextBrokerService,
    private readonly evidenceGenerator: EvidenceGeneratorService,
    private readonly policyResolver: PolicyResolverService,
    private readonly repairService: RepairService,
    private readonly repoService: RepoService,
    private readonly reviewService: ReviewService,
    private readonly runnerService: RunnerService,
    private readonly verificationService: VerificationService,
  ) {}

  private async isRunStopped(runId: string): Promise<boolean> {
    const run = await prisma.agentRun.findUnique({
      where: { id: runId },
      select: { status: true },
    });
    return run?.status === 'stopped';
  }

  private async finalizeStoppedRun(
    taskId: string,
    runId: string,
    data?: { commandsRun?: string[] },
  ): Promise<void> {
    await this.runnerService.updateRunStatus(runId, 'stopped', {
      finishedAt: new Date(),
      ...(data?.commandsRun ? { commandsRun: data.commandsRun } : {}),
    });
    await prisma.agentTask.update({
      where: { id: taskId },
      data: { status: 'stopped' },
    });
  }

  private async executeAgentPass(
    taskId: string,
    runId: string,
    agentName: string,
    plan: Awaited<ReturnType<AgentService['prepareRun']>>,
    stage: 'EXECUTE' | 'REPAIR',
  ) {
    if (stage === 'REPAIR') {
      this.logger.log(`[${taskId}] Stage: REPAIR (run ${runId})`);
      await this.runnerService.updateRunStatus(runId, 'repairing');
    } else {
      this.logger.log(`[${taskId}] Stage: EXECUTE (run ${runId})`);
    }

    await this.runnerService.updateRunStatus(runId, 'running', {
      startedAt: new Date(),
    });
    const eventStream = await this.agentService.run(agentName, plan);
    for await (const event of eventStream) {
      await this.runnerService.addEvent(runId, event.type, event.data);
    }

    const diff = await this.agentService.collectDiff(agentName, runId);
    const agentEvidence = await this.agentService.collectEvidence(agentName, runId);
    return { diff, agentEvidence };
  }

  private async persistExecutionArtifacts(
    runId: string,
    diff: Awaited<ReturnType<AgentService['collectDiff']>>,
    agentEvidence: Awaited<ReturnType<AgentService['collectEvidence']>>,
  ) {
    const changedFiles = diff.files.map((file) => file.path);
    const diffText = diff.files.map((file) => file.patch).filter(Boolean).join('\n');

    await prisma.agentRun.update({
      where: { id: runId },
      data: {
        diffSummary: diff.summary,
        diffFull: diffText,
        filesChanged: changedFiles,
        networkUsed: agentEvidence.networkUsed,
        secretsAccessed: agentEvidence.secretsAccessed,
      },
    });

    return { changedFiles, diffText };
  }

  private buildVerificationFailureLog(verification: {
    checks: Record<string, 'passed' | 'failed' | 'skipped'>;
    commandResults?: Partial<Record<'lint' | 'typecheck' | 'build' | 'unit_tests', { stdout?: string; stderr?: string }>>;
    testWeakeningDetected: boolean;
  }): string {
    const failedChecks = Object.entries(verification.checks)
      .filter(([, status]) => status === 'failed')
      .map(([name]) => name);

    const commandLogs = Object.entries(verification.commandResults ?? {})
      .map(([, result]) => [result?.stdout, result?.stderr].filter(Boolean).join('\n'))
      .filter(Boolean)
      .join('\n');

    return [
      failedChecks.length > 0 ? `Failed checks: ${failedChecks.join(', ')}` : '',
      verification.testWeakeningDetected ? 'Test weakening detected' : '',
      commandLogs,
    ]
      .filter(Boolean)
      .join('\n');
  }

  private buildReviewFailureLog(review: Record<string, unknown>): string {
    const summary = typeof review.summary === 'string' ? review.summary : 'Review requires changes';
    const findings = Array.isArray(review.findings)
      ? review.findings
          .map((finding) => {
            if (!finding || typeof finding !== 'object') {
              return '';
            }
            const record = finding as Record<string, unknown>;
            return [record.severity, record.category, record.message].filter(Boolean).join(': ');
          })
          .filter(Boolean)
          .join('\n')
      : '';

    return [summary, findings].filter(Boolean).join('\n');
  }

  private slugifyBranchSegment(input: string): string {
    const normalized = input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return normalized.slice(0, 40) || 'task';
  }

  private buildPullRequestDraft(task: {
    id: string;
    goal: string;
    sourceType: string;
    sourceUrl: string | null;
    sourcePayload: unknown;
    doneWhen: string[];
  }, repo: { defaultBranch: string; url: string | null }, headBranch: string): PullRequestDraftEvent {
    const issueNumber = (() => {
      if (!task.sourcePayload || typeof task.sourcePayload !== 'object') {
        return null;
      }
      const payload = task.sourcePayload as Record<string, unknown>;
      const issue = payload.issue;
      if (!issue || typeof issue !== 'object') {
        return null;
      }
      const number = (issue as Record<string, unknown>).number;
      return typeof number === 'number' ? number : null;
    })();

    const titleGoal = task.goal.trim().replace(/\s+/g, ' ');
    const titleSuffix = issueNumber ? ` (#${issueNumber})` : '';
    const title = `AI: ${titleGoal}${titleSuffix}`.slice(0, 120);
    const doneWhen = task.doneWhen.length > 0
      ? task.doneWhen.map((entry) => `- ${entry}`).join('\n')
      : '- Verification passes';
    const compareUrl = repo.url
      ? `${repo.url.replace(/\/$/, '')}/compare/${encodeURIComponent(repo.defaultBranch)}...${encodeURIComponent(headBranch)}?expand=1`
      : null;

    return {
      title,
      body: [
        '## Summary',
        titleGoal,
        '',
        '## Source',
        `- Type: ${task.sourceType}`,
        `- Task ID: ${task.id}`,
        ...(task.sourceUrl ? [`- Reference: ${task.sourceUrl}`] : []),
        '',
        '## Done When',
        doneWhen,
      ].join('\n'),
      baseBranch: repo.defaultBranch,
      headBranch,
      compareUrl,
      sourceType: task.sourceType,
      sourceUrl: task.sourceUrl,
    };
  }

  private async maybeGeneratePullRequestDraft(
    task: {
      id: string;
      goal: string;
      sourceType: string;
      sourceUrl: string | null;
      sourcePayload: unknown;
      doneWhen: string[];
    },
    repo: { defaultBranch: string; url: string | null } | null,
    runId: string,
    branch: string | undefined,
    changedFiles: string[],
  ): Promise<void> {
    if (!repo) {
      return;
    }

    if (!['github_issue', 'manual'].includes(task.sourceType)) {
      return;
    }

    const headBranch =
      branch?.trim() ||
      `ai/${this.slugifyBranchSegment(task.goal)}-${task.id.slice(0, 8)}`;

    if (changedFiles.length === 0) {
      await this.runnerService.addEvent(runId, 'pr_draft_skipped', {
        reason: 'No file changes were produced, so no pull request draft was generated.',
        headBranch,
        baseBranch: repo.defaultBranch,
      });
      return;
    }

    const draft = this.buildPullRequestDraft(task, repo, headBranch);
    await this.runnerService.addEvent(runId, 'pr_draft_generated', draft);
  }

  async scheduleTask(taskId: string): Promise<{ taskId: string; status: 'accepted' | 'already_running' }> {
    const task = await prisma.agentTask.findUnique({ where: { id: taskId } });
    if (!task) {
      throw new NotFoundException(`Task not found: ${taskId}`);
    }

    if (this.activeTasks.has(taskId)) {
      return { taskId, status: 'already_running' };
    }

    const activeRun = await prisma.agentRun.findFirst({
      where: {
        taskId,
        status: {
          in: ['queued', 'preparing', 'running', 'verifying', 'reviewing', 'repairing', 'waiting_approval'],
        },
      },
    });
    if (activeRun) {
      throw new ConflictException(`Task ${taskId} already has an active run`);
    }

    this.activeTasks.add(taskId);
    await prisma.agentTask.update({
      where: { id: taskId },
      data: { status: 'queued' },
    });

    setImmediate(() => {
      void this.executeTask(taskId)
        .catch((error) => {
          this.logger.error(`Background pipeline failed for task ${taskId}: ${error}`);
        })
        .finally(() => {
          this.activeTasks.delete(taskId);
        });
    });

    return { taskId, status: 'accepted' };
  }

  async executeTask(taskId: string): Promise<void> {
    this.logger.log(`Starting pipeline for task ${taskId}`);

    const task = await prisma.agentTask.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException(`Task not found: ${taskId}`);

    let runId: string | undefined;
    const agentName = task.preferredAgent ?? 'claude_code';
    const repoMetadata = await this.repoService.findOne(task.repoId);
    const brokerRepoContext = {
      fullName: repoMetadata?.fullName ?? null,
      localPath: repoMetadata?.localPath ?? null,
    };
    const taskContext = this.contextBroker.buildAgentTaskContext(task, brokerRepoContext);

    try {
      await prisma.agentTask.update({
        where: { id: taskId },
        data: { status: 'in_progress' },
      });

      // Stage 1: Resolve policy
      this.logger.log(`[${taskId}] Stage: RESOLVE_POLICY`);
      const effectivePolicy = await this.policyResolver.resolveEffectivePolicy(
        task.repoId,
        undefined,
        {
          filesystem: task.filesystemMode as 'read_only' | 'workspace_write' | 'full_access',
          network: {
            mode: task.networkMode as 'disabled' | 'allowlist' | 'unrestricted',
            domains: task.networkDomains,
            methods: [],
          },
          secrets: {
            mode: task.secretsMode as 'none' | 'setup_only' | 'task_scoped',
            refs: [],
          },
        } as Record<string, unknown>,
      );

      // Stage 2: Create run
      this.logger.log(`[${taskId}] Stage: PREPARE_RUN`);
      const brokeredContextSummary = this.contextBroker.buildContextSummary(
        task,
        brokerRepoContext,
        effectivePolicy,
        taskContext,
      );
      const plan = await this.agentService.prepareRun(agentName, taskContext, effectivePolicy);
      const run = await this.runnerService.createRun(taskId, agentName);
      runId = run.id;
      plan.runId = run.id;
      await this.runnerService.updateRunStatus(run.id, 'preparing', {
        branch: plan.branch,
        commandsRun: [plan.command, ...plan.args],
      });
      await this.runnerService.addEvent(run.id, 'run_prepared', {
        branch: plan.branch,
        sandboxDir: plan.sandboxDir,
        command: plan.command,
        args: plan.args,
        timeoutMs: plan.timeoutMs,
      });
      await this.runnerService.addEvent(
        run.id,
        'context_brokered',
        brokeredContextSummary,
      );
      if (await this.isRunStopped(run.id)) {
        await this.finalizeStoppedRun(taskId, run.id, {
          commandsRun: [plan.command, ...plan.args],
        });
        return;
      }

      // Stage 3: Execute
      let currentPlan = plan;
      let { diff, agentEvidence } = await this.executeAgentPass(taskId, run.id, agentName, currentPlan, 'EXECUTE');
      if (agentEvidence.stoppedByUser || (await this.isRunStopped(run.id))) {
        await this.finalizeStoppedRun(taskId, run.id, {
          commandsRun:
            agentEvidence.commandsRun.length > 0 ? agentEvidence.commandsRun : [plan.command, ...plan.args],
        });
        return;
      }
      if (!agentEvidence.succeeded) {
        throw new Error(
          `Agent execution failed for run ${run.id} with exit code ${agentEvidence.exitCode ?? 'unknown'}`,
        );
      }
      let { changedFiles, diffText } = await this.persistExecutionArtifacts(run.id, diff, agentEvidence);
      if (await this.isRunStopped(run.id)) {
        await this.finalizeStoppedRun(taskId, run.id, {
          commandsRun:
            agentEvidence.commandsRun.length > 0 ? agentEvidence.commandsRun : [plan.command, ...plan.args],
        });
        return;
      }

      const repo = await this.repoService.findOne(task.repoId);
      let verified = false;
      let reviewed = false;

      while (!verified || !reviewed) {
        // Stage 4: Verify
        this.logger.log(`[${taskId}] Stage: VERIFY`);
        await this.runnerService.updateRunStatus(run.id, 'verifying');
        await this.runnerService.addEvent(run.id, 'verification_started', {
          workingDirectory: currentPlan.sandboxDir,
          checks: ['secret_scan', 'sast_scan', 'dependency_scan', 'license_scan', 'lint', 'typecheck', 'build', 'unit_tests'],
        });
        const verification = await this.verificationService.runChecks(
          {
            testCommand: repo?.testCommand ?? undefined,
            lintCommand: repo?.lintCommand ?? undefined,
            typecheckCommand: repo?.typecheckCommand ?? undefined,
            buildCommand: repo?.buildCommand ?? undefined,
            focusPaths: taskContext.allowedPaths,
            brokeredContext: brokeredContextSummary,
          },
          changedFiles,
          diffText,
          currentPlan.sandboxDir,
          {
            onCheckStarted: async (checkName, command) => {
              await this.runnerService.addEvent(run.id, 'verification_check_started', {
                checkName,
                command: command ?? null,
              });
            },
            onCheckCompleted: async (checkName, status, result) => {
              await this.runnerService.addEvent(run.id, 'verification_check_completed', {
                checkName,
                status,
                exitCode: result?.exitCode ?? null,
                stdout: result?.stdout ?? '',
                stderr: result?.stderr ?? '',
              });
            },
          },
        );
        await this.runnerService.addEvent(run.id, 'verification_completed', verification as unknown as Record<string, unknown>);
        if (await this.isRunStopped(run.id)) {
          await this.finalizeStoppedRun(taskId, run.id, {
            commandsRun:
              agentEvidence.commandsRun.length > 0 ? agentEvidence.commandsRun : [plan.command, ...plan.args],
          });
          return;
        }
        if (!verification.passed) {
          const failureLog = this.buildVerificationFailureLog(verification);
          this.logger.log(`[${taskId}] Stage: REPAIR_DECISION (verification failure)`);
          const repairAttempt = await this.repairService.attemptRepair(
            run.id,
            failureLog,
            task.maxRepairLoops,
            {
              forbidTestDeletion: task.forbidTestDeletion,
              forbidPolicyWeakening: task.forbidPolicyWeakening,
            },
          );
          await this.runnerService.addEvent(run.id, 'repair_attempted', {
            origin: 'verification',
            ...repairAttempt,
          });
          if (!repairAttempt.success) {
            throw new Error(repairAttempt.reason ?? 'Repair attempt failed');
          }

          currentPlan = await this.agentService.prepareRun(agentName, taskContext, effectivePolicy);
          currentPlan.runId = run.id;
          ({ diff, agentEvidence } = await this.executeAgentPass(taskId, run.id, agentName, currentPlan, 'REPAIR'));
          if (agentEvidence.stoppedByUser || (await this.isRunStopped(run.id))) {
            await this.finalizeStoppedRun(taskId, run.id, {
              commandsRun:
                agentEvidence.commandsRun.length > 0 ? agentEvidence.commandsRun : [plan.command, ...plan.args],
            });
            return;
          }
          if (!agentEvidence.succeeded) {
            throw new Error(
              `Agent repair failed for run ${run.id} with exit code ${agentEvidence.exitCode ?? 'unknown'}`,
            );
          }
          ({ changedFiles, diffText } = await this.persistExecutionArtifacts(run.id, diff, agentEvidence));
          continue;
        }
        verified = true;

        // Stage 5: Review
        this.logger.log(`[${taskId}] Stage: REVIEW`);
        await this.runnerService.updateRunStatus(run.id, 'reviewing');
        const review = await this.reviewService.performReview(run.id, agentName);
        await this.runnerService.addEvent(run.id, 'review_completed', review as Record<string, unknown>);
        if (
          typeof review.reviewBody === 'string' &&
          Array.isArray(review.reviewComments) &&
          typeof review.suggestedAction === 'string'
        ) {
          await this.runnerService.addEvent(run.id, 'pr_review_draft_generated', {
            action: review.suggestedAction,
            body: review.reviewBody,
            comments: review.reviewComments,
          });
        }
        if (await this.isRunStopped(run.id)) {
          await this.finalizeStoppedRun(taskId, run.id, {
            commandsRun:
              agentEvidence.commandsRun.length > 0 ? agentEvidence.commandsRun : [plan.command, ...plan.args],
          });
          return;
        }

        const verdict = typeof review.verdict === 'string' ? review.verdict : 'approved';
        if (verdict === 'requires_changes' || verdict === 'blocked') {
          const failureLog = this.buildReviewFailureLog(review);
          this.logger.log(`[${taskId}] Stage: REPAIR_DECISION (review failure)`);
          const repairAttempt = await this.repairService.attemptRepair(
            run.id,
            failureLog,
            task.maxRepairLoops,
            {
              forbidTestDeletion: task.forbidTestDeletion,
              forbidPolicyWeakening: task.forbidPolicyWeakening,
            },
          );
          await this.runnerService.addEvent(run.id, 'repair_attempted', {
            origin: 'review',
            ...repairAttempt,
            verdict,
          });
          if (!repairAttempt.success) {
            throw new Error(repairAttempt.reason ?? 'Repair attempt failed');
          }

          verified = false;
          currentPlan = await this.agentService.prepareRun(agentName, taskContext, effectivePolicy);
          currentPlan.runId = run.id;
          ({ diff, agentEvidence } = await this.executeAgentPass(taskId, run.id, agentName, currentPlan, 'REPAIR'));
          if (agentEvidence.stoppedByUser || (await this.isRunStopped(run.id))) {
            await this.finalizeStoppedRun(taskId, run.id, {
              commandsRun:
                agentEvidence.commandsRun.length > 0 ? agentEvidence.commandsRun : [plan.command, ...plan.args],
            });
            return;
          }
          if (!agentEvidence.succeeded) {
            throw new Error(
              `Agent repair failed for run ${run.id} with exit code ${agentEvidence.exitCode ?? 'unknown'}`,
            );
          }
          ({ changedFiles, diffText } = await this.persistExecutionArtifacts(run.id, diff, agentEvidence));
          continue;
        }
        reviewed = true;
      }

      // Stage 7: Evidence
      this.logger.log(`[${taskId}] Stage: EVIDENCE`);
      const evidence = await this.evidenceGenerator.generate(taskId, run.id);
      await this.runnerService.addEvent(run.id, 'evidence_generated', {
        schemaVersion: evidence['schema_version'],
      });
      if (await this.isRunStopped(run.id)) {
        await this.finalizeStoppedRun(taskId, run.id, {
          commandsRun:
            agentEvidence.commandsRun.length > 0 ? agentEvidence.commandsRun : [plan.command, ...plan.args],
        });
        return;
      }

      await this.maybeGeneratePullRequestDraft(
        {
          id: task.id,
          goal: task.goal,
          sourceType: task.sourceType,
          sourceUrl: task.sourceUrl,
          sourcePayload: task.sourcePayload,
          doneWhen: task.doneWhen,
        },
        repo
          ? {
              defaultBranch: repo.defaultBranch,
              url: repo.url,
            }
          : null,
        run.id,
        currentPlan.branch,
        changedFiles,
      );

      // Stage 8: Complete
      this.logger.log(`[${taskId}] Stage: COMPLETE`);
      await this.runnerService.updateRunStatus(run.id, 'completed', {
        finishedAt: new Date(),
        commandsRun: agentEvidence.commandsRun.length > 0 ? agentEvidence.commandsRun : [plan.command, ...plan.args],
      });
      await prisma.agentTask.update({
        where: { id: taskId },
        data: { status: 'completed' },
      });

      this.logger.log(`Pipeline completed for task ${taskId}`);
    } catch (error) {
      this.logger.error(`Pipeline failed for task ${taskId}: ${error}`);
      if (runId && (await this.isRunStopped(runId))) {
        await prisma.agentTask.update({
          where: { id: taskId },
          data: { status: 'stopped' },
        });
        return;
      }
      if (runId) {
        await this.runnerService.addEvent(runId, 'error', {
          message: error instanceof Error ? error.message : String(error),
        });
        await this.runnerService.updateRunStatus(runId, 'failed', {
          finishedAt: new Date(),
        });
      }
      await prisma.agentTask.update({
        where: { id: taskId },
        data: { status: 'failed' },
      });
      throw error;
    } finally {
      if (runId) {
        try {
          await this.agentService.cleanup(agentName, runId);
        } catch (cleanupError) {
          this.logger.warn(
            `Cleanup failed for run ${runId}: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
          );
        }
      }
    }
  }

}
