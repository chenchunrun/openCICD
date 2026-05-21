const mockPrisma = {
  agentTask: {
    findUnique: jest.fn(),
  },
};

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn(() => mockPrisma),
}));

import type { ReviewGateService } from '../review/review-gate.service';
import { ReleaseService } from './release.service';

describe('ReleaseService', () => {
  let service: ReleaseService;
  let reviewGateServiceMock: jest.Mocked<ReviewGateService>;

  beforeEach(() => {
    jest.clearAllMocks();

    reviewGateServiceMock = {
      evaluate: jest.fn(),
    } as unknown as jest.Mocked<ReviewGateService>;

    service = new ReleaseService(reviewGateServiceMock);
  });

  it('returns a structured gate with blockers and warnings', async () => {
    mockPrisma.agentTask.findUnique.mockResolvedValue({
      id: 'task-1',
      goal: 'Promote API changes',
      riskLevel: 'high',
      requiresHumanApproval: true,
      approvals: [],
      repo: {
        fullName: 'newmba/CICD',
        defaultBranch: 'main',
        url: 'https://github.com/newmba/CICD',
      },
      runs: [
        {
          id: 'run-1',
          status: 'completed',
          branch: 'ai/task-1',
          commitSha: 'abc123',
          filesChanged: ['apps/api/src/main.ts'],
          commandsRun: ['pnpm test'],
          agentName: 'codex',
          events: [
            {
              type: 'context_brokered',
              data: {
                riskLevel: 'high',
                trustBoundaries: {
                  requiresHumanApproval: true,
                },
              },
            },
            {
              type: 'verification_completed',
              data: {
                passed: true,
                checks: {
                  typecheck: 'passed',
                },
              },
            },
          ],
          repairs: [
            {
              loopNumber: 1,
              escalationReason: 'Needs human follow-up',
            },
          ],
          reviews: [
            {
              verdict: 'requires_human_review',
              summary: 'Focused human review recommended.',
            },
          ],
        },
      ],
      evidences: [
        {
          id: 'evidence-1',
          status: 'complete',
        },
      ],
    });
    reviewGateServiceMock.evaluate.mockResolvedValue({
      canMerge: true,
      blockers: [],
      warnings: ['Security review recommended for high-risk changes'],
    });

    const result = await service.evaluateGate('task-1');

    expect(result.canRelease).toBe(false);
    expect(result.latestRunId).toBe('run-1');
    expect(result.blockers).toContain('Human approval required');
    expect(result.checks.evidence_complete?.passed).toBe(true);
    expect(result.checks.review_ready?.passed).toBe(true);
    expect(result.checks.approval_received?.passed).toBe(false);
    expect(result.warnings).toContain('Repair escalation recorded: Needs human follow-up');
  });

  it('generates a release plan with notes and rollback steps', async () => {
    mockPrisma.agentTask.findUnique
      .mockResolvedValueOnce({
        id: 'task-1',
        goal: 'Promote API changes',
        riskLevel: 'medium',
        requiresHumanApproval: false,
        approvals: [{ action: 'approved' }],
        repo: {
          fullName: 'newmba/CICD',
          defaultBranch: 'main',
          url: 'https://github.com/newmba/CICD',
        },
        runs: [
          {
            id: 'run-1',
            status: 'completed',
            branch: 'ai/task-1',
            commitSha: 'abc123',
            filesChanged: ['apps/api/src/main.ts'],
            commandsRun: ['pnpm test', 'pnpm build'],
            agentName: 'codex',
            events: [
              {
                type: 'verification_completed',
                data: { passed: true },
              },
            ],
            repairs: [],
            reviews: [
              {
                verdict: 'approved',
                summary: 'No material issues detected in rule-based review.',
              },
            ],
          },
        ],
        evidences: [
          {
            id: 'evidence-1',
            status: 'complete',
          },
        ],
      })
      .mockResolvedValueOnce({
        id: 'task-1',
        goal: 'Promote API changes',
        repo: {
          fullName: 'newmba/CICD',
          defaultBranch: 'main',
          url: 'https://github.com/newmba/CICD',
        },
        runs: [
          {
            id: 'run-1',
            status: 'completed',
            branch: 'ai/task-1',
            commitSha: 'abc123',
            filesChanged: ['apps/api/src/main.ts'],
            commandsRun: ['pnpm test', 'pnpm build'],
            agentName: 'codex',
            events: [
              {
                type: 'context_brokered',
                data: {
                  riskLevel: 'medium',
                  trustBoundaries: {
                    requiresHumanApproval: false,
                  },
                },
              },
            ],
            reviews: [
              {
                summary: 'No material issues detected in rule-based review.',
              },
            ],
          },
        ],
      });
    reviewGateServiceMock.evaluate.mockResolvedValue({
      canMerge: true,
      blockers: [],
      warnings: [],
    });

    const result = await service.generateReleasePlan('task-1');

    expect(result.deploymentRecommendation).toBe('ready');
    expect(result.releaseNotes).toContain('Task: Promote API changes');
    expect(result.releaseNotes).toContain('apps/api/src/main.ts');
    expect(result.releaseNotes).toContain('### Scan Summary');
    expect(result.releaseNotes).toContain('### Scan Findings');
    expect(result.releaseNotes).toContain('Secret scan: unknown');
    expect(result.rollbackPlan[0]).toContain('Pause rollout');
    expect(result.compareUrl).toBe(
      'https://github.com/newmba/CICD/compare/main...ai%2Ftask-1?expand=1',
    );
  });

  it('uses brokered context to require approval even when task fields are low risk', async () => {
    mockPrisma.agentTask.findUnique.mockResolvedValue({
      id: 'task-2',
      goal: 'Promote dashboard changes',
      riskLevel: 'low',
      requiresHumanApproval: false,
      approvals: [],
      repo: {
        fullName: 'newmba/CICD',
        defaultBranch: 'main',
        url: 'https://github.com/newmba/CICD',
      },
      runs: [
        {
          id: 'run-2',
          status: 'completed',
          branch: 'ai/task-2',
          commitSha: 'def456',
          filesChanged: ['apps/dashboard/src/app/page.tsx'],
          commandsRun: ['pnpm build'],
          agentName: 'codex',
          events: [
            {
              type: 'context_brokered',
              data: {
                riskLevel: 'high',
                trustBoundaries: {
                  requiresHumanApproval: true,
                },
              },
            },
            {
              type: 'verification_completed',
              data: {
                passed: true,
              },
            },
          ],
          repairs: [],
          reviews: [
            {
              verdict: 'approved',
              summary: 'No material issues detected in rule-based review.',
            },
          ],
        },
      ],
      evidences: [
        {
          id: 'evidence-2',
          status: 'complete',
        },
      ],
    });
    reviewGateServiceMock.evaluate.mockResolvedValue({
      canMerge: true,
      blockers: [],
      warnings: [],
    });

    const result = await service.evaluateGate('task-2');

    expect(result.canRelease).toBe(false);
    expect(result.checks.approval_received?.required).toBe(true);
    expect(result.checks.approval_received?.passed).toBe(false);
    expect(result.blockers).toContain('Human approval required');
  });

  it('surfaces scan-specific release blockers when verification is blocked by license risk', async () => {
    mockPrisma.agentTask.findUnique.mockResolvedValue({
      id: 'task-3',
      goal: 'Promote dependency metadata changes',
      riskLevel: 'medium',
      requiresHumanApproval: false,
      approvals: [{ action: 'approved' }],
      repo: {
        fullName: 'newmba/CICD',
        defaultBranch: 'main',
        url: 'https://github.com/newmba/CICD',
      },
      runs: [
        {
          id: 'run-3',
          status: 'completed',
          branch: 'ai/task-3',
          commitSha: 'ghi789',
          filesChanged: ['package.json'],
          commandsRun: ['pnpm test'],
          agentName: 'codex',
          events: [
            {
              type: 'verification_completed',
              data: {
                passed: false,
                checks: {
                  license_scan: 'failed',
                  typecheck: 'passed',
                },
                licenseScanFindings: [
                  {
                    type: 'restricted_license',
                    match: '"license": "BUSL-1.1"',
                  },
                ],
              },
            },
          ],
          repairs: [],
          reviews: [
            {
              verdict: 'approved',
              summary: 'No material issues detected in rule-based review.',
            },
          ],
        },
      ],
      evidences: [
        {
          id: 'evidence-3',
          status: 'complete',
        },
      ],
    });
    reviewGateServiceMock.evaluate.mockResolvedValue({
      canMerge: true,
      blockers: [],
      warnings: [],
    });

    const result = await service.evaluateGate('task-3');

    expect(result.canRelease).toBe(false);
    expect(result.checks.license_scan_clear).toEqual(
      expect.objectContaining({
        passed: false,
        detail: 'License scan status: failed.',
      }),
    );
    expect(result.blockers).toContain('License scan must pass before release');
    expect(result.warnings).toContain('License scan flagged the latest run.');
    expect(result.warnings).toContain('License scan findings: 1 (restricted_license)');
  });

  it('escalates scan failures into required human approval even for otherwise low-risk tasks', async () => {
    mockPrisma.agentTask.findUnique.mockResolvedValue({
      id: 'task-4',
      goal: 'Promote package metadata changes',
      riskLevel: 'low',
      requiresHumanApproval: false,
      approvals: [],
      repo: {
        fullName: 'newmba/CICD',
        defaultBranch: 'main',
        url: 'https://github.com/newmba/CICD',
      },
      runs: [
        {
          id: 'run-4',
          status: 'completed',
          branch: 'ai/task-4',
          commitSha: 'jkl012',
          filesChanged: ['package.json'],
          commandsRun: ['pnpm test'],
          agentName: 'codex',
          events: [
            {
              type: 'verification_completed',
              data: {
                passed: false,
                checks: {
                  license_scan: 'failed',
                },
              },
            },
          ],
          repairs: [],
          reviews: [
            {
              verdict: 'approved',
              summary: 'No material issues detected in rule-based review.',
            },
          ],
        },
      ],
      evidences: [
        {
          id: 'evidence-4',
          status: 'complete',
        },
      ],
    });
    reviewGateServiceMock.evaluate.mockResolvedValue({
      canMerge: true,
      blockers: [],
      warnings: [],
    });

    const result = await service.evaluateGate('task-4');

    expect(result.checks.approval_received).toEqual(
      expect.objectContaining({
        required: true,
        passed: false,
        detail: 'Required human approval is still missing after blocking scan findings.',
      }),
    );
    expect(result.blockers).toContain('Human approval required after blocking scan findings');
  });
});
