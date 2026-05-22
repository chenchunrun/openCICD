const mockPrisma = {
  agentTask: {
    findUnique: jest.fn(),
  },
  agentEventRecord: {
    create: jest.fn(),
  },
};

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn(() => mockPrisma),
}));

import type { ReviewGateService } from '../review/review-gate.service';
import type { WorkflowGeneratorService } from '../repo/workflow-generator.service';
import type { ConfigService } from '../../config/configuration';
import { ReleaseService } from './release.service';

describe('ReleaseService', () => {
  let service: ReleaseService;
  let reviewGateServiceMock: jest.Mocked<ReviewGateService>;
  let workflowGeneratorMock: jest.Mocked<WorkflowGeneratorService>;
  let configMock: { githubToken: string; githubApiUrl: string };

  beforeEach(() => {
    jest.clearAllMocks();

    reviewGateServiceMock = {
      evaluate: jest.fn(),
    } as unknown as jest.Mocked<ReviewGateService>;
    workflowGeneratorMock = {
      inspectWorkflowDefinitions: jest.fn(),
    } as unknown as jest.Mocked<WorkflowGeneratorService>;

    configMock = {
      githubToken: 'github-token',
      githubApiUrl: 'https://api.github.test',
    };

    workflowGeneratorMock.inspectWorkflowDefinitions.mockResolvedValue([
      {
        filename: 'ai-release.yml',
        displayName: 'Release Gate',
        purpose: 'Fetches release gate and release plan artifacts.',
        installPath: '.github/workflows/ai-release.yml',
        triggers: ['Manual workflow_dispatch with task_id'],
        requiredSecrets: ['AICP_API_URL'],
        content: 'name: AI Release Gate',
        installation: {
          status: 'installed',
          detail: 'Local workflow matches the generated template.',
        },
        secrets: [
          {
            name: 'AICP_API_URL',
            status: 'required_but_unverified',
            detail: 'GitHub repository secrets cannot be verified from the local checkout. Confirm this secret exists in GitHub before dispatch.',
          },
        ],
      },
    ]);

    service = new ReleaseService(
      reviewGateServiceMock,
      configMock as ConfigService,
      workflowGeneratorMock,
    );
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
    expect(result.checks.github_repo_connected?.passed).toBe(true);
    expect(result.checks.github_release_workflow_declared?.detail).toContain('.github/workflows/ai-release.yml');
    expect(result.checks.github_release_workflow_installed?.passed).toBe(true);
    expect(result.checks.github_token_configured?.passed).toBe(true);
    expect(result.warnings).toContain('Repair escalation recorded: Needs human follow-up');
  });

  it('blocks release when the connected checkout is missing the release workflow', async () => {
    workflowGeneratorMock.inspectWorkflowDefinitions.mockResolvedValue([
      {
        filename: 'ai-release.yml',
        displayName: 'Release Gate',
        purpose: 'Fetches release gate and release plan artifacts.',
        installPath: '.github/workflows/ai-release.yml',
        triggers: ['Manual workflow_dispatch with task_id'],
        requiredSecrets: ['AICP_API_URL'],
        content: 'name: AI Release Gate',
        installation: {
          status: 'missing',
          detail: 'Expected workflow file was not found in the connected local checkout.',
        },
        secrets: [],
      },
    ]);

    mockPrisma.agentTask.findUnique.mockResolvedValue({
      id: 'task-1',
      goal: 'Promote API changes',
      riskLevel: 'low',
      requiresHumanApproval: false,
      approvals: [{ action: 'approved' }],
      repo: {
        fullName: 'newmba/CICD',
        defaultBranch: 'main',
        url: 'https://github.com/newmba/CICD',
        localPath: '/Users/newmba/CICD',
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
              type: 'verification_completed',
              data: {
                passed: true,
                checks: {},
              },
            },
          ],
          repairs: [],
          reviews: [
            {
              verdict: 'approved',
              summary: 'No material issues detected.',
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
      warnings: [],
    });

    const result = await service.evaluateGate('task-1');

    expect(result.canRelease).toBe(false);
    expect(result.checks.github_release_workflow_installed?.passed).toBe(false);
    expect(result.blockers).toContain(
      'Release workflow ai-release.yml is missing from the connected checkout',
    );
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
                type: 'github_review_submitted',
                data: {
                  actor: {
                    role: 'operator',
                    name: 'review-bot',
                    source: 'dashboard',
                  },
                  reviewUrl: 'https://github.com/newmba/CICD/pull/42#pullrequestreview-501',
                },
              },
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
                type: 'github_review_submitted',
                data: {
                  actor: {
                    role: 'operator',
                    name: 'review-bot',
                    source: 'dashboard',
                  },
                  reviewUrl: 'https://github.com/newmba/CICD/pull/42#pullrequestreview-501',
                },
              },
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
    expect(result.deliveryActions).toEqual([
      expect.objectContaining({
        type: 'github_review_submitted',
        actor: expect.objectContaining({
          role: 'operator',
          name: 'review-bot',
          source: 'dashboard',
        }),
      }),
    ]);
    expect(result.githubDispatch).toEqual(
      expect.objectContaining({
        ready: true,
        workflow: 'ai-release.yml',
        workflowPath: '.github/workflows/ai-release.yml',
        actionsUrl: 'https://github.com/newmba/CICD/actions/workflows/ai-release.yml',
        dispatchUrl: 'https://api.github.test/repos/newmba/CICD/actions/workflows/ai-release.yml/dispatches',
      }),
    );
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

  it('dispatches the GitHub release workflow when the gate is clear', async () => {
    const actor = { role: 'releaser', name: 'ops-console', source: 'dashboard' } as const;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response) as jest.Mock;

    mockPrisma.agentTask.findUnique
      .mockResolvedValueOnce({
        id: 'task-3',
        goal: 'Release API changes',
        riskLevel: 'low',
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
            commitSha: 'abc123',
            filesChanged: ['apps/api/src/main.ts'],
            commandsRun: ['pnpm test'],
            agentName: 'codex',
            events: [
              {
                type: 'verification_completed',
                data: {
                  passed: true,
                  checks: {
                    secret_scan: 'passed',
                    sast_scan: 'passed',
                    dependency_scan: 'passed',
                    license_scan: 'passed',
                  },
                },
              },
            ],
            repairs: [],
            reviews: [
              {
                verdict: 'approved',
                summary: 'No material issues detected.',
              },
            ],
          },
        ],
        evidences: [{ id: 'evidence-3', status: 'complete' }],
      })
      .mockResolvedValueOnce({
        id: 'task-3',
        goal: 'Release API changes',
        riskLevel: 'low',
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
            commitSha: 'abc123',
            filesChanged: ['apps/api/src/main.ts'],
            commandsRun: ['pnpm test'],
            agentName: 'codex',
            events: [],
            repairs: [],
            reviews: [
              {
                summary: 'No material issues detected.',
              },
            ],
          },
        ],
        evidences: [{ id: 'evidence-3', status: 'complete' }],
      });
    reviewGateServiceMock.evaluate.mockResolvedValue({
      canMerge: true,
      blockers: [],
      warnings: [],
    });
    mockPrisma.agentEventRecord.create.mockResolvedValue({ id: 'event-1' });

    const result = await service.dispatchGithubRelease('task-3', actor);

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.github.test/repos/newmba/CICD/actions/workflows/ai-release.yml/dispatches',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    expect(mockPrisma.agentEventRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        runId: 'run-3',
        type: 'github_release_dispatched',
        data: expect.objectContaining({
          actor,
        }),
      }),
    });
    expect(result).toEqual(
      expect.objectContaining({
        taskId: 'task-3',
        dispatched: true,
        workflow: 'ai-release.yml',
        workflowPath: '.github/workflows/ai-release.yml',
        actor,
      }),
    );
  });

  it('blocks the release gate when the GitHub token is missing', async () => {
    configMock.githubToken = '';
    mockPrisma.agentTask.findUnique.mockResolvedValue({
      id: 'task-6',
      goal: 'Release API changes',
      riskLevel: 'low',
      requiresHumanApproval: false,
      approvals: [{ action: 'approved' }],
      repo: {
        fullName: 'newmba/CICD',
        defaultBranch: 'main',
        url: 'https://github.com/newmba/CICD',
      },
      runs: [
        {
          id: 'run-6',
          status: 'completed',
          branch: 'ai/task-6',
          commitSha: 'abc999',
          filesChanged: ['apps/api/src/main.ts'],
          commandsRun: ['pnpm test'],
          agentName: 'codex',
          events: [
            {
              type: 'verification_completed',
              data: {
                passed: true,
                checks: {
                  secret_scan: 'passed',
                  sast_scan: 'passed',
                  dependency_scan: 'passed',
                  license_scan: 'passed',
                },
              },
            },
          ],
          repairs: [],
          reviews: [
            {
              verdict: 'approved',
              summary: 'No material issues detected.',
            },
          ],
        },
      ],
      evidences: [{ id: 'evidence-6', status: 'complete' }],
    });
    reviewGateServiceMock.evaluate.mockResolvedValue({
      canMerge: true,
      blockers: [],
      warnings: [],
    });

    const result = await service.evaluateGate('task-6');

    expect(result.canRelease).toBe(false);
    expect(result.checks.github_token_configured).toEqual(
      expect.objectContaining({
        passed: false,
        detail: 'GITHUB_TOKEN is not configured for release dispatch.',
      }),
    );
    expect(result.blockers).toContain('GitHub token is required for release dispatch');
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

  it('syncs the latest GitHub release workflow status back into run events', async () => {
    const actor = { role: 'releaser', name: 'ops-console', source: 'dashboard' } as const;
    mockPrisma.agentTask.findUnique.mockResolvedValue({
      id: 'task-5',
      goal: 'Dispatch release workflow',
      repo: {
        fullName: 'newmba/CICD',
        defaultBranch: 'main',
        url: 'https://github.com/newmba/CICD',
      },
      runs: [
        {
          id: 'run-5',
          branch: 'main',
          events: [
            {
              type: 'github_release_dispatched',
              timestamp: '2026-05-21T10:00:00.000Z',
              data: {
                workflow: 'ai-release.yml',
                ref: 'main',
                actionsUrl: 'https://github.com/newmba/CICD/actions/workflows/ai-release.yml',
              },
            },
          ],
        },
      ],
    });
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        workflow_runs: [
          {
            id: 701,
            run_number: 22,
            head_branch: 'main',
            status: 'completed',
            conclusion: 'success',
            html_url: 'https://github.com/newmba/CICD/actions/runs/701',
            created_at: '2026-05-21T10:01:00.000Z',
            updated_at: '2026-05-21T10:04:00.000Z',
          },
        ],
      }),
    });
    mockPrisma.agentEventRecord.create.mockResolvedValue({ id: 'event-sync-1' });

    const result = await service.syncGithubReleaseStatus('task-5', actor);

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.github.test/repos/newmba/CICD/actions/workflows/ai-release.yml/runs?event=workflow_dispatch&branch=main&per_page=20',
      expect.objectContaining({
        method: 'GET',
      }),
    );
    expect(mockPrisma.agentEventRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        runId: 'run-5',
        type: 'github_release_status_synced',
        data: expect.objectContaining({
          workflowRunId: 701,
          status: 'completed',
          conclusion: 'success',
          actor,
        }),
      }),
    });
    expect(result).toEqual(
      expect.objectContaining({
        taskId: 'task-5',
        synced: true,
        found: true,
        workflowRunId: 701,
        status: 'completed',
        conclusion: 'success',
      }),
    );
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
