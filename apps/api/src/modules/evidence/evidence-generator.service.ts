import { Injectable } from '@nestjs/common';
import { PrismaClient, type ApprovalAction, type ReviewVerdict, type RunStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { EvidenceService } from './evidence.service.js';

const prisma = new PrismaClient();

type EventRecord = {
  type: string;
  data: unknown;
};

@Injectable()
export class EvidenceGeneratorService {
  constructor(private readonly evidenceService: EvidenceService) {}

  async generate(taskId: string, runId?: string): Promise<Record<string, unknown>> {
    const task = await prisma.agentTask.findUnique({
      where: { id: taskId },
      include: {
        approvals: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!task) throw new Error(`Task not found: ${taskId}`);

    const repo = await prisma.repository.findUnique({ where: { id: task.repoId } });
    const run = runId
      ? await prisma.agentRun.findUnique({
          where: { id: runId },
          include: {
            events: { orderBy: { timestamp: 'asc' } },
            repairs: { orderBy: { loopNumber: 'asc' } },
            reviews: { orderBy: { reviewedAt: 'desc' } },
          },
        })
      : null;

    const verificationSection = this.buildVerificationSection(run?.events ?? []);
    const reviewSection = this.buildReviewSection({
      taskRequiresHumanApproval: task.requiresHumanApproval,
      approvals: task.approvals.map((approval) => approval.action),
      latestReview: run?.reviews?.[0],
    });
    const repairSection = this.buildRepairSection(run?.repairs.length ?? 0, run?.status);
    const executionSection = {
      commandsRun: run?.commandsRun ?? [],
      filesChanged: run?.filesChanged ?? [],
      networkUsed: run?.networkUsed ?? false,
      secretsAccessed: run?.secretsAccessed ?? false,
    };
    const contextSection = this.buildContextSection(task, run?.events ?? []);
    const fullEvidence = {
      schema_version: '1.0',
      task_id: taskId,
      run_id: runId,
      repo: repo?.fullName,
      agent: {
        name: run?.agentName ?? task.preferredAgent ?? 'unknown',
        executionMode: run?.executionMode ?? 'cli',
        adapterVersion: 'unknown',
      },
      policy: {
        riskLevel: task.riskLevel,
        policy: {
          filesystem: task.filesystemMode,
          network: { mode: task.networkMode, domains: task.networkDomains },
          secrets: { mode: task.secretsMode },
        },
      },
      context: contextSection,
      execution: executionSection,
      verification: verificationSection,
      review: reviewSection,
      repair: repairSection,
      residual_risk: {
        accepted: false,
        notes: this.buildResidualRiskNotes(task.riskLevel, run?.status),
      },
    } satisfies Prisma.InputJsonObject;

    const evidence = await this.evidenceService.create({
      taskId,
      runId: runId ?? undefined,
      repo: repo?.fullName ?? '',
      sourceSha: run?.commitSha ?? undefined,
      targetBranch: run?.branch ?? undefined,
      agentSection: fullEvidence.agent as Record<string, unknown>,
      policySection: fullEvidence.policy as Record<string, unknown>,
      contextSection: contextSection as Record<string, unknown>,
      executionSection,
      verificationSection,
      reviewSection,
      repairSection,
      residualRiskSection: fullEvidence.residual_risk as Record<string, unknown>,
    });

    await prisma.evidence.update({
      where: { id: evidence.id },
      data: { fullEvidence: fullEvidence as Prisma.InputJsonValue, status: 'complete' },
    });

    return fullEvidence;
  }

  private getLatestEvent(events: EventRecord[], type: string): EventRecord | undefined {
    return [...events].reverse().find((event) => event.type === type);
  }

  private buildVerificationSection(events: EventRecord[]): Prisma.InputJsonObject {
    const verificationEvent = this.getLatestEvent(events, 'verification_completed');
    const rawChecks =
      verificationEvent?.data && typeof verificationEvent.data === 'object'
        ? (verificationEvent.data as Record<string, unknown>).checks
        : undefined;
    if (!rawChecks || typeof rawChecks !== 'object') {
      return {};
    }

    const checks = rawChecks as Record<string, unknown>;
    const normalizedChecks = Object.fromEntries(
      Object.entries(checks).map(([name, value]) => {
        const status = value === 'passed' || value === 'failed' || value === 'skipped' ? value : 'skipped';
        return [name, status];
      }),
    );

    const verificationData =
      verificationEvent?.data && typeof verificationEvent.data === 'object'
        ? (verificationEvent.data as Record<string, unknown>)
        : {};

    const scanFindings = {
      secret_scan: this.getFindingList(verificationData.secretScanFindings),
      sast_scan: this.getFindingList(verificationData.sastScanFindings),
      dependency_scan: this.getFindingList(verificationData.dependencyScanFindings),
      license_scan: this.getFindingList(verificationData.licenseScanFindings),
    } satisfies Record<string, Array<Record<string, unknown>>>;

    return {
      ...normalizedChecks,
      scanFindings,
    } as Prisma.InputJsonObject;
  }

  private getFindingList(value: unknown): Array<Record<string, unknown>> {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
      .map((entry) => ({ ...entry }));
  }

  private buildContextSection(
    task: {
      sourceType: string;
      requiresHumanApproval: boolean;
      filesystemMode: string;
      networkMode: string;
      networkDomains: string[];
      secretsMode: string;
    },
    events: EventRecord[],
  ): Prisma.InputJsonObject {
    const brokerEvent = this.getLatestEvent(events, 'context_brokered');
    if (brokerEvent?.data && typeof brokerEvent.data === 'object') {
      return brokerEvent.data as Prisma.InputJsonObject;
    }

    return {
      trustedSources: ['repo files'],
      untrustedSources: task.sourceType === 'github_issue' ? ['issue body'] : [],
      enforcement: {
        filesystem: task.filesystemMode,
        networkMode: task.networkMode,
        networkDomains: task.networkDomains,
        secretsMode: task.secretsMode,
      },
      trustBoundaries: {
        requiresHumanApproval: task.requiresHumanApproval,
      },
    };
  }

  private buildReviewSection(input: {
    taskRequiresHumanApproval: boolean;
    approvals: ApprovalAction[];
    latestReview?: {
      verdict: ReviewVerdict;
    } | null;
  }) {
    const approved = input.approvals.includes('approved');
    const rejected = input.approvals.includes('rejected');

    return {
      aiReview: input.latestReview ? 'completed' : 'pending',
      humanReview: input.taskRequiresHumanApproval ? (approved || rejected ? 'completed' : 'required') : 'waived',
      codeOwnerApproval: rejected ? 'rejected' : approved ? 'approved' : 'pending',
    };
  }

  private buildRepairSection(loops: number, status?: RunStatus | null) {
    const finalStatus =
      loops === 0
        ? 'not_needed'
        : status === 'completed'
          ? 'passed'
          : 'failed';

    return {
      loops,
      finalStatus,
    };
  }

  private buildResidualRiskNotes(riskLevel: string, status?: RunStatus | null): string[] {
    const notes: string[] = [];
    if (riskLevel === 'high' || riskLevel === 'critical') {
      notes.push(`Task risk level remains ${riskLevel}.`);
    }
    if (status === 'failed') {
      notes.push('Run ended in failed state.');
    }
    if (status === 'stopped') {
      notes.push('Run was stopped before completion.');
    }
    return notes;
  }
}
