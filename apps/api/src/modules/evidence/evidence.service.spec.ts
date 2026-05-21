const mockPrisma = {
  evidence: {
    findMany: jest.fn(),
    create: jest.fn(),
  },
};

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn(() => mockPrisma),
}));

import { EvidenceService } from './evidence.service';

describe('EvidenceService', () => {
  let service: EvidenceService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new EvidenceService();
  });

  it('exports a structured bundle with scan finding totals and approval counts', async () => {
    mockPrisma.evidence.findMany.mockResolvedValue([
      {
        id: 'evidence-1',
        taskId: 'task-1',
        runId: 'run-1',
        repo: 'acme/service',
        schemaVersion: '1.0',
        status: 'complete',
        createdAt: new Date('2026-05-21T00:00:00.000Z'),
        verificationSection: {
          lint: 'passed',
          secret_scan: 'failed',
          scanFindings: {
            secret_scan: [{ type: 'github_token', match: 'ghp_example' }],
            license_scan: [{ type: 'restricted_license', match: 'BUSL-1.1' }],
          },
        },
        reviewSection: {
          humanReview: 'required',
          codeOwnerApproval: 'pending',
        },
        repairSection: {
          loops: 1,
        },
        residualRiskSection: {
          notes: ['Task risk level remains high.'],
        },
        contextSection: {
          trustBoundaries: {
            requiresHumanApproval: true,
          },
        },
      },
    ]);

    const result = await service.exportBundle({ taskIds: ['task-1'] });

    expect(mockPrisma.evidence.findMany).toHaveBeenCalledWith({
      where: {
        taskId: { in: ['task-1'] },
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(result.summary).toEqual({
      evidenceCount: 1,
      failedVerificationCount: 1,
      approvalPendingCount: 1,
      scanFindingTotals: {
        secret_scan: 1,
        license_scan: 1,
      },
    });
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        evidenceId: 'evidence-1',
        verification: {
          checks: {
            lint: 'passed',
            secret_scan: 'failed',
          },
          scanFindings: {
            secret_scan: [{ type: 'github_token', match: 'ghp_example' }],
            license_scan: [{ type: 'restricted_license', match: 'BUSL-1.1' }],
          },
        },
      }),
    );
  });

  it('can export only evidence records that contain scan findings', async () => {
    mockPrisma.evidence.findMany.mockResolvedValue([
      {
        id: 'evidence-1',
        taskId: 'task-1',
        runId: 'run-1',
        repo: 'acme/service',
        schemaVersion: '1.0',
        status: 'complete',
        createdAt: new Date('2026-05-21T00:00:00.000Z'),
        verificationSection: {
          lint: 'passed',
          scanFindings: {
            secret_scan: [{ type: 'github_token', match: 'ghp_example' }],
          },
        },
        reviewSection: {},
        repairSection: {},
        residualRiskSection: {},
        contextSection: {},
      },
      {
        id: 'evidence-2',
        taskId: 'task-2',
        runId: 'run-2',
        repo: 'acme/service',
        schemaVersion: '1.0',
        status: 'complete',
        createdAt: new Date('2026-05-21T01:00:00.000Z'),
        verificationSection: {
          lint: 'passed',
          scanFindings: {
            secret_scan: [],
            sast_scan: [],
            dependency_scan: [],
            license_scan: [],
          },
        },
        reviewSection: {},
        repairSection: {},
        residualRiskSection: {},
        contextSection: {},
      },
    ]);

    const result = await service.exportBundle({ scanFindingsOnly: true });

    expect(result.summary.evidenceCount).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.evidenceId).toBe('evidence-1');
  });

  it('can export only evidence records that are still pending approval', async () => {
    mockPrisma.evidence.findMany.mockResolvedValue([
      {
        id: 'evidence-1',
        taskId: 'task-1',
        runId: 'run-1',
        repo: 'acme/service',
        schemaVersion: '1.0',
        status: 'complete',
        createdAt: new Date('2026-05-21T00:00:00.000Z'),
        verificationSection: {},
        reviewSection: {
          humanReview: 'required',
          codeOwnerApproval: 'pending',
        },
        repairSection: {},
        residualRiskSection: {},
        contextSection: {},
      },
      {
        id: 'evidence-2',
        taskId: 'task-2',
        runId: 'run-2',
        repo: 'acme/service',
        schemaVersion: '1.0',
        status: 'complete',
        createdAt: new Date('2026-05-21T01:00:00.000Z'),
        verificationSection: {},
        reviewSection: {
          humanReview: 'waived',
          codeOwnerApproval: 'approved',
        },
        repairSection: {},
        residualRiskSection: {},
        contextSection: {},
      },
    ]);

    const result = await service.exportBundle({ approvalPendingOnly: true });

    expect(result.summary.evidenceCount).toBe(1);
    expect(result.summary.approvalPendingCount).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.evidenceId).toBe('evidence-1');
  });

  it('can export only evidence records that match requested scan types', async () => {
    mockPrisma.evidence.findMany.mockResolvedValue([
      {
        id: 'evidence-1',
        taskId: 'task-1',
        runId: 'run-1',
        repo: 'acme/service',
        schemaVersion: '1.0',
        status: 'complete',
        createdAt: new Date('2026-05-21T00:00:00.000Z'),
        verificationSection: {
          scanFindings: {
            secret_scan: [{ type: 'github_token', match: 'ghp_example' }],
            license_scan: [],
          },
        },
        reviewSection: {},
        repairSection: {},
        residualRiskSection: {},
        contextSection: {},
      },
      {
        id: 'evidence-2',
        taskId: 'task-2',
        runId: 'run-2',
        repo: 'acme/service',
        schemaVersion: '1.0',
        status: 'complete',
        createdAt: new Date('2026-05-21T01:00:00.000Z'),
        verificationSection: {
          scanFindings: {
            secret_scan: [],
            license_scan: [{ type: 'restricted_license', match: 'BUSL-1.1' }],
          },
        },
        reviewSection: {},
        repairSection: {},
        residualRiskSection: {},
        contextSection: {},
      },
    ]);

    const result = await service.exportBundle({ scanTypes: ['license_scan'] });

    expect(result.summary.evidenceCount).toBe(1);
    expect(result.summary.scanFindingTotals).toEqual({
      license_scan: 1,
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.evidenceId).toBe('evidence-2');
  });
});
