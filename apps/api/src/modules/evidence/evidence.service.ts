import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type EvidenceExportFilters = {
  taskIds?: string[];
  runIds?: string[];
  scanFindingsOnly?: boolean;
  approvalPendingOnly?: boolean;
  scanTypes?: string[];
};

const SUPPORTED_SCAN_TYPES = new Set([
  'secret_scan',
  'sast_scan',
  'dependency_scan',
  'license_scan',
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

      if (filters.scanFindingsOnly && !hasScanFindings) {
        return false;
      }
      if (!hasRequestedScanTypes) {
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
    };

    return {
      generatedAt: new Date().toISOString(),
      filters: {
        ...filters,
        scanTypes: filters.scanTypes?.filter((scanType) => SUPPORTED_SCAN_TYPES.has(scanType)),
      },
      summary,
      items: filteredItems,
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
