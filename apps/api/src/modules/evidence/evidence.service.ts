import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type EvidenceExportFilters = {
  taskIds?: string[];
  runIds?: string[];
  scanFindingsOnly?: boolean;
  approvalPendingOnly?: boolean;
  scanTypes?: string[];
  actionTypes?: string[];
};

const SUPPORTED_SCAN_TYPES = new Set([
  'secret_scan',
  'sast_scan',
  'dependency_scan',
  'license_scan',
]);

const SUPPORTED_ACTION_TYPES = new Set([
  'task_approved',
  'task_rejected',
  'run_stopped',
  'github_pull_request_created',
  'github_review_submitted',
  'github_release_dispatched',
  'github_release_status_synced',
]);

@Injectable()
export class EvidenceService {
  async listAll() {
    return prisma.evidence.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async getByTask(taskId: string) {
    return prisma.evidence.findMany({ where: { taskId } });
  }

  async getByRun(runId: string) {
    return prisma.evidence.findMany({ where: { runId } });
  }

  async export(taskIds?: string[], runIds?: string[]) {
    const where: Record<string, unknown> = {};
    if (taskIds?.length) where.taskId = { in: taskIds };
    if (runIds?.length) where.runId = { in: runIds };

    const evidences = await prisma.evidence.findMany({ where });
    return evidences.map((e) => e.fullEvidence ?? e);
  }

  async exportBundle(filters: EvidenceExportFilters) {
    const where: Record<string, unknown> = {};
    if (filters.taskIds?.length) where.taskId = { in: filters.taskIds };
    if (filters.runIds?.length) where.runId = { in: filters.runIds };

    const evidences = await prisma.evidence.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    const items = evidences.map((evidence) => {
      const verificationSection =
        evidence.verificationSection && typeof evidence.verificationSection === 'object'
          ? (evidence.verificationSection as Record<string, unknown>)
          : {};
      const reviewSection =
        evidence.reviewSection && typeof evidence.reviewSection === 'object'
          ? (evidence.reviewSection as Record<string, unknown>)
          : {};
      const repairSection =
        evidence.repairSection && typeof evidence.repairSection === 'object'
          ? (evidence.repairSection as Record<string, unknown>)
          : {};
      const residualRiskSection =
        evidence.residualRiskSection && typeof evidence.residualRiskSection === 'object'
          ? (evidence.residualRiskSection as Record<string, unknown>)
          : {};
      const contextSection =
        evidence.contextSection && typeof evidence.contextSection === 'object'
          ? (evidence.contextSection as Record<string, unknown>)
          : {};

      const execution =
        evidence.executionSection && typeof evidence.executionSection === 'object' && !Array.isArray(evidence.executionSection)
          ? (evidence.executionSection as Record<string, unknown>)
          : {};

      return {
        evidenceId: evidence.id,
        taskId: evidence.taskId,
        runId: evidence.runId,
        repo: evidence.repo,
        schemaVersion: evidence.schemaVersion,
        status: evidence.status,
        createdAt: evidence.createdAt,
        verification: {
          checks: Object.fromEntries(
            Object.entries(verificationSection).filter(([key]) => key !== 'scanFindings'),
          ),
          scanFindings:
            verificationSection.scanFindings && typeof verificationSection.scanFindings === 'object'
              ? verificationSection.scanFindings
              : {},
        },
        execution,
        deliveryActions:
          execution.deliveryActions && Array.isArray(execution.deliveryActions)
            ? execution.deliveryActions
            : [],
        review: reviewSection,
        repair: repairSection,
        residualRisk: residualRiskSection,
        context: contextSection,
      };
    });

    const filteredItems = items.filter((item) => {
      const scanFindings =
        item.verification.scanFindings && typeof item.verification.scanFindings === 'object'
          ? (item.verification.scanFindings as Record<string, unknown>)
          : {};
      const hasScanFindings = Object.values(scanFindings).some(
        (findings) => Array.isArray(findings) && findings.length > 0,
      );
      const hasRequestedScanTypes =
        !filters.scanTypes?.length ||
        filters.scanTypes.some((scanType) => {
          const findings = scanFindings[scanType];
          return Array.isArray(findings) && findings.length > 0;
        });
      const humanReview = item.review.humanReview;
      const codeOwnerApproval = item.review.codeOwnerApproval;
      const approvalPending = humanReview === 'required' || codeOwnerApproval === 'pending';
      const hasRequestedActionTypes =
        !filters.actionTypes?.length ||
        item.deliveryActions.some((action) => {
          if (!action || typeof action !== 'object') {
            return false;
          }

          const type = (action as Record<string, unknown>).type;
          return typeof type === 'string' && filters.actionTypes?.includes(type);
        });

      if (filters.scanFindingsOnly && !hasScanFindings) {
        return false;
      }
      if (!hasRequestedScanTypes) {
        return false;
      }
      if (!hasRequestedActionTypes) {
        return false;
      }
      if (filters.approvalPendingOnly && !approvalPending) {
        return false;
      }
      return true;
    });

    const summary = {
      evidenceCount: filteredItems.length,
      failedVerificationCount: filteredItems.filter((item) =>
        Object.values(item.verification.checks).includes('failed'),
      ).length,
      approvalPendingCount: filteredItems.filter((item) => {
        const humanReview = item.review.humanReview;
        const codeOwnerApproval = item.review.codeOwnerApproval;
        return humanReview === 'required' || codeOwnerApproval === 'pending';
      }).length,
      scanFindingTotals: filteredItems.reduce<Record<string, number>>((acc, item) => {
        const scanFindings =
          item.verification.scanFindings && typeof item.verification.scanFindings === 'object'
            ? (item.verification.scanFindings as Record<string, unknown>)
            : {};

        for (const [scanType, findings] of Object.entries(scanFindings)) {
          const count = Array.isArray(findings) ? findings.length : 0;
          if (count > 0) {
            acc[scanType] = (acc[scanType] ?? 0) + count;
          }
        }

        return acc;
      }, {}),
      deliveryActionTotals: filteredItems.reduce<Record<string, number>>((acc, item) => {
        const execution = item.execution as Record<string, unknown>;
        const deliveryActions =
          execution.deliveryActions && Array.isArray(execution.deliveryActions)
            ? execution.deliveryActions
            : [];

        for (const action of deliveryActions) {
          if (!action || typeof action !== 'object') {
            continue;
          }

          const type = (action as Record<string, unknown>).type;
          if (typeof type === 'string') {
            acc[type] = (acc[type] ?? 0) + 1;
          }
        }

        return acc;
      }, {}),
      preparationModeTotals: filteredItems.reduce<Record<string, number>>((acc, item) => {
        const execution = item.execution as Record<string, unknown>;
        const preparationMode = execution.preparationMode;

        if (typeof preparationMode === 'string' && preparationMode.length > 0) {
          acc[preparationMode] = (acc[preparationMode] ?? 0) + 1;
        } else {
          acc.unknown = (acc.unknown ?? 0) + 1;
        }

        return acc;
      }, {}),
      governanceActionTotals: filteredItems.reduce<Record<string, number>>((acc, item) => {
        for (const action of item.deliveryActions) {
          if (!action || typeof action !== 'object') {
            continue;
          }

          const type = (action as Record<string, unknown>).type;
          if (type === 'task_approved') {
            acc.approved = (acc.approved ?? 0) + 1;
          } else if (type === 'task_rejected') {
            acc.rejected = (acc.rejected ?? 0) + 1;
          } else if (type === 'run_stopped') {
            acc.stopped = (acc.stopped ?? 0) + 1;
          }
        }

        return acc;
      }, {}),
    };

    const activity = filteredItems
      .flatMap((item) =>
        item.deliveryActions
          .filter((action): action is Record<string, unknown> => Boolean(action) && typeof action === 'object')
          .map((action) => ({
            evidenceId: item.evidenceId,
            taskId: item.taskId,
            runId: item.runId,
            repo: item.repo,
            type: typeof action.type === 'string' ? action.type : 'unknown',
            timestamp: typeof action.timestamp === 'string' ? action.timestamp : null,
            targetUrl: typeof action.targetUrl === 'string' ? action.targetUrl : null,
            actor:
              action.actor && typeof action.actor === 'object'
                ? (action.actor as Record<string, unknown>)
                : null,
          })),
      )
      .sort((left, right) => {
        const leftTime = left.timestamp ? Date.parse(left.timestamp) : 0;
        const rightTime = right.timestamp ? Date.parse(right.timestamp) : 0;
        return rightTime - leftTime;
      });

    return {
      generatedAt: new Date().toISOString(),
      filters: {
        ...filters,
        scanTypes: filters.scanTypes?.filter((scanType) => SUPPORTED_SCAN_TYPES.has(scanType)),
        actionTypes: filters.actionTypes?.filter((actionType) => SUPPORTED_ACTION_TYPES.has(actionType)),
      },
      summary,
      items: filteredItems,
      activity,
    };
  }

  async create(data: {
    taskId: string;
    runId?: string;
    repo: string;
    sourceSha?: string;
    targetBranch?: string;
    agentSection?: Record<string, unknown>;
    policySection?: Record<string, unknown>;
    contextSection?: Record<string, unknown>;
    executionSection?: Record<string, unknown>;
    verificationSection?: Record<string, unknown>;
    reviewSection?: Record<string, unknown>;
    repairSection?: Record<string, unknown>;
    residualRiskSection?: Record<string, unknown>;
  }) {
    return prisma.evidence.create({ data: data as any });
  }
}
