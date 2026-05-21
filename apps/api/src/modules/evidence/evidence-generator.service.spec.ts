const mockPrisma = {
  agentTask: {
    findUnique: jest.fn(),
  },
  repository: {
    findUnique: jest.fn(),
  },
  agentRun: {
    findUnique: jest.fn(),
  },
  evidence: {
    update: jest.fn(),
  },
};

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn(() => mockPrisma),
}));

import type { EvidenceService } from './evidence.service';
import { EvidenceGeneratorService } from './evidence-generator.service';

describe('EvidenceGeneratorService', () => {
  let service: EvidenceGeneratorService;
  let evidenceServiceMock: jest.Mocked<EvidenceService>;

  beforeEach(() => {
    jest.clearAllMocks();

    evidenceServiceMock = {
      create: jest.fn(),
    } as unknown as jest.Mocked<EvidenceService>;

    service = new EvidenceGeneratorService(evidenceServiceMock);
  });

  it('builds evidence from actual run, review, and verification data', async () => {
    mockPrisma.agentTask.findUnique.mockResolvedValue({
      id: 'task-1',
      repoId: 'repo-1',
      preferredAgent: 'codex',
      riskLevel: 'high',
      filesystemMode: 'workspace_write',
      networkMode: 'disabled',
      networkDomains: [],
      secretsMode: 'none',
      sourceType: 'manual',
      requiresHumanApproval: true,
      approvals: [{ action: 'approved' }],
    });
    mockPrisma.repository.findUnique.mockResolvedValue({
      id: 'repo-1',
      fullName: 'acme/service',
    });
    mockPrisma.agentRun.findUnique.mockResolvedValue({
      id: 'run-1',
      agentName: 'codex',
      executionMode: 'cli',
      commitSha: 'abc123',
      branch: 'ai/task-task-1',
      status: 'completed',
      commandsRun: ['codex exec'],
      filesChanged: ['apps/api/src/app.ts'],
      networkUsed: false,
      secretsAccessed: false,
      events: [
        {
          type: 'context_brokered',
          data: {
            taskId: 'task-1',
            sourceType: 'manual',
            enforcement: {
              filesystem: 'workspace_write',
              networkMode: 'disabled',
              networkDomains: [],
              secretsMode: 'none',
            },
            trustBoundaries: {
              requiresHumanApproval: true,
              hasPathRestrictions: true,
              offlineByDefault: true,
            },
          },
        },
        {
          type: 'verification_completed',
          data: {
            checks: {
              lint: 'passed',
              unit_tests: 'failed',
              build: 'skipped',
            },
            secretScanFindings: [
              {
                type: 'github_token',
                match: 'ghp_exampletoken1234567890',
              },
            ],
            licenseScanFindings: [
              {
                type: 'restricted_license',
                match: '"license": "BUSL-1.1"',
              },
            ],
          },
        },
      ],
      repairs: [{ loopNumber: 1 }],
      reviews: [
        {
          verdict: 'approved',
        },
      ],
    });
    evidenceServiceMock.create.mockResolvedValue({
      id: 'evidence-1',
      verificationSection: {},
      reviewSection: {},
      agentSection: {},
      policySection: {},
      contextSection: {},
      repairSection: {},
      residualRiskSection: {},
    } as any);
    mockPrisma.evidence.update.mockResolvedValue({ id: 'evidence-1' });

    const result = await service.generate('task-1', 'run-1');

    expect(evidenceServiceMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-1',
        runId: 'run-1',
        repo: 'acme/service',
        sourceSha: 'abc123',
        targetBranch: 'ai/task-task-1',
        executionSection: {
          commandsRun: ['codex exec'],
          filesChanged: ['apps/api/src/app.ts'],
          networkUsed: false,
          secretsAccessed: false,
        },
        verificationSection: {
          lint: 'passed',
          unit_tests: 'failed',
          build: 'skipped',
          scanFindings: {
            secret_scan: [
              {
                type: 'github_token',
                match: 'ghp_exampletoken1234567890',
              },
            ],
            sast_scan: [],
            dependency_scan: [],
            license_scan: [
              {
                type: 'restricted_license',
                match: '"license": "BUSL-1.1"',
              },
            ],
          },
        },
        reviewSection: {
          aiReview: 'completed',
          humanReview: 'completed',
          codeOwnerApproval: 'approved',
        },
        repairSection: {
          loops: 1,
          finalStatus: 'passed',
        },
      }),
    );
    expect(mockPrisma.evidence.update).toHaveBeenCalledWith({
      where: { id: 'evidence-1' },
      data: {
        fullEvidence: result,
        status: 'complete',
      },
    });
    expect(result).toEqual(
      expect.objectContaining({
        run_id: 'run-1',
        repo: 'acme/service',
        execution: {
          commandsRun: ['codex exec'],
          filesChanged: ['apps/api/src/app.ts'],
          networkUsed: false,
          secretsAccessed: false,
        },
        verification: {
          lint: 'passed',
          unit_tests: 'failed',
          build: 'skipped',
          scanFindings: {
            secret_scan: [
              {
                type: 'github_token',
                match: 'ghp_exampletoken1234567890',
              },
            ],
            sast_scan: [],
            dependency_scan: [],
            license_scan: [
              {
                type: 'restricted_license',
                match: '"license": "BUSL-1.1"',
              },
            ],
          },
        },
        review: {
          aiReview: 'completed',
          humanReview: 'completed',
          codeOwnerApproval: 'approved',
        },
        repair: {
          loops: 1,
          finalStatus: 'passed',
        },
        residual_risk: {
          accepted: false,
          notes: ['Task risk level remains high.'],
        },
        context: {
          taskId: 'task-1',
          sourceType: 'manual',
          enforcement: {
            filesystem: 'workspace_write',
            networkMode: 'disabled',
            networkDomains: [],
            secretsMode: 'none',
          },
          trustBoundaries: {
            requiresHumanApproval: true,
            hasPathRestrictions: true,
            offlineByDefault: true,
          },
        },
      }),
    );
  });
});
