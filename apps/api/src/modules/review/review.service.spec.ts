const mockPrisma = {
  agentRun: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  agentEventRecord: {
    create: jest.fn(),
  },
  reviewResultRecord: {
    create: jest.fn(),
    findMany: jest.fn(),
  },
};

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn(() => mockPrisma),
}));

import type { AgentRegistryService } from '../agent/agent-registry.service';
import type { ConfigService } from '../../config/configuration';
import { ReviewService } from './review.service';

describe('ReviewService', () => {
  let service: ReviewService;
  let registryMock: jest.Mocked<AgentRegistryService>;
  let configMock: Pick<ConfigService, 'githubToken' | 'githubApiUrl'>;

  beforeEach(() => {
    jest.clearAllMocks();

    registryMock = {
      getAlternativeAgent: jest.fn(),
    } as unknown as jest.Mocked<AgentRegistryService>;

    configMock = {
      githubToken: 'github-token',
      githubApiUrl: 'https://api.github.test',
    };

    service = new ReviewService(registryMock, configMock as ConfigService);
  });

  it('requires changes when verification fails', async () => {
    registryMock.getAlternativeAgent.mockReturnValue({
      config: { name: 'claude_code' },
      adapter: {} as never,
    } as any);
    mockPrisma.agentRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'reviewing',
      filesChanged: ['apps/api/src/app.ts'],
      networkUsed: false,
      secretsAccessed: false,
      task: {
        riskLevel: 'medium',
        requiresHumanApproval: false,
        repo: {
          highRiskPaths: ['.github/workflows/**'],
        },
      },
      events: [
        {
          type: 'verification_completed',
          data: {
            checks: {
              unit_tests: 'failed',
              lint: 'passed',
            },
            testWeakeningDetected: false,
          },
        },
      ],
    });
    mockPrisma.reviewResultRecord.create.mockImplementation(async ({ data }) => ({ id: 'review-1', ...data }) as any);

    const result = await service.performReview('run-1', 'codex');

    expect(mockPrisma.reviewResultRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        runId: 'run-1',
        agentName: 'claude_code',
        verdict: 'requires_changes',
        findings: expect.arrayContaining([
          expect.objectContaining({
            severity: 'high',
            category: 'test_quality',
            message: 'Unit tests failed during verification.',
          }),
        ]),
      }),
    });
    expect(result).toEqual(
      expect.objectContaining({
        verdict: 'requires_changes',
        suggestedAction: 'REQUEST_CHANGES',
        reviewComments: expect.arrayContaining([
          expect.objectContaining({
            path: 'apps/api/src/app.ts',
            severity: 'high',
          }),
        ]),
      }),
    );
  });

  it('requires changes when dependency scan flags a supply-chain risk', async () => {
    registryMock.getAlternativeAgent.mockReturnValue({
      config: { name: 'claude_code' },
      adapter: {} as never,
    } as any);
    mockPrisma.agentRun.findUnique.mockResolvedValue({
      id: 'run-dep-1',
      status: 'reviewing',
      filesChanged: ['package.json'],
      networkUsed: false,
      secretsAccessed: false,
      task: {
        riskLevel: 'medium',
        requiresHumanApproval: false,
        repo: {
          highRiskPaths: ['.github/workflows/**'],
        },
      },
      events: [
        {
          type: 'verification_completed',
          data: {
            checks: {
              dependency_scan: 'failed',
            },
            testWeakeningDetected: false,
          },
        },
      ],
    });
    mockPrisma.reviewResultRecord.create.mockImplementation(async ({ data }) => ({ id: 'review-dep-1', ...data }) as any);

    const result = await service.performReview('run-dep-1', 'codex');

    expect(result).toEqual(
      expect.objectContaining({
        verdict: 'requires_changes',
      }),
    );
    expect(mockPrisma.reviewResultRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        findings: expect.arrayContaining([
          expect.objectContaining({
            severity: 'high',
            category: 'security',
            message: 'Dependency scan detected a risky package source or install hook in the change set.',
          }),
        ]),
      }),
    });
  });

  it('requires changes when license scan flags a restricted license', async () => {
    registryMock.getAlternativeAgent.mockReturnValue({
      config: { name: 'claude_code' },
      adapter: {} as never,
    } as any);
    mockPrisma.agentRun.findUnique.mockResolvedValue({
      id: 'run-license-1',
      status: 'reviewing',
      filesChanged: ['package.json'],
      networkUsed: false,
      secretsAccessed: false,
      task: {
        riskLevel: 'medium',
        requiresHumanApproval: false,
        repo: {
          highRiskPaths: ['.github/workflows/**'],
        },
      },
      events: [
        {
          type: 'verification_completed',
          data: {
            checks: {
              license_scan: 'failed',
            },
            testWeakeningDetected: false,
          },
        },
      ],
    });
    mockPrisma.reviewResultRecord.create.mockImplementation(async ({ data }) => ({ id: 'review-license-1', ...data }) as any);

    const result = await service.performReview('run-license-1', 'codex');

    expect(result).toEqual(
      expect.objectContaining({
        verdict: 'requires_changes',
      }),
    );
    expect(mockPrisma.reviewResultRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        findings: expect.arrayContaining([
          expect.objectContaining({
            severity: 'high',
            category: 'architecture_consistency',
            message: 'License scan detected a restricted or custom license declaration in the change set.',
          }),
        ]),
      }),
    });
  });

  it('requires human review for high-risk path changes when verification passes', async () => {
    registryMock.getAlternativeAgent.mockReturnValue({
      config: { name: 'claude_code' },
      adapter: {} as never,
    } as any);
    mockPrisma.agentRun.findUnique.mockResolvedValue({
      id: 'run-2',
      status: 'reviewing',
      filesChanged: ['.github/workflows/ci.yml'],
      networkUsed: false,
      secretsAccessed: false,
      task: {
        riskLevel: 'medium',
        requiresHumanApproval: false,
        repo: {
          highRiskPaths: ['.github/workflows/**'],
        },
      },
      events: [
        {
          type: 'verification_completed',
          data: {
            checks: {
              unit_tests: 'passed',
              lint: 'passed',
            },
            testWeakeningDetected: false,
          },
        },
      ],
    });
    mockPrisma.reviewResultRecord.create.mockImplementation(async ({ data }) => ({ id: 'review-2', ...data }) as any);

    const result = await service.performReview('run-2', 'codex');

    expect(result).toEqual(
      expect.objectContaining({
        verdict: 'requires_human_review',
        suggestedAction: 'COMMENT',
      }),
    );
    expect(mockPrisma.reviewResultRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        findings: expect.arrayContaining([
          expect.objectContaining({
            severity: 'medium',
            category: 'security',
            file: '.github/workflows/ci.yml',
          }),
        ]),
      }),
    });
  });

  it('approves clean runs without material findings', async () => {
    registryMock.getAlternativeAgent.mockReturnValue({
      config: { name: 'claude_code' },
      adapter: {} as never,
    } as any);
    mockPrisma.agentRun.findUnique.mockResolvedValue({
      id: 'run-3',
      status: 'reviewing',
      filesChanged: ['apps/dashboard/src/app/page.tsx'],
      networkUsed: false,
      secretsAccessed: false,
      task: {
        riskLevel: 'low',
        requiresHumanApproval: false,
        repo: {
          highRiskPaths: ['.github/workflows/**'],
        },
      },
      events: [
        {
          type: 'verification_completed',
          data: {
            checks: {
              unit_tests: 'passed',
              lint: 'passed',
              typecheck: 'passed',
              build: 'passed',
            },
            testWeakeningDetected: false,
          },
        },
      ],
    });
    mockPrisma.reviewResultRecord.create.mockImplementation(async ({ data }) => ({ id: 'review-3', ...data }) as any);

    const result = await service.performReview('run-3', 'codex');

    expect(result).toEqual(
      expect.objectContaining({
        verdict: 'approved',
        summary: 'No material issues detected in rule-based review.',
        suggestedAction: 'COMMENT',
        reviewBody: expect.stringContaining('AI review summary'),
      }),
    );
  });

  it('uses brokered context to require human review even when task record is low risk', async () => {
    registryMock.getAlternativeAgent.mockReturnValue({
      config: { name: 'claude_code' },
      adapter: {} as never,
    } as any);
    mockPrisma.agentRun.findUnique.mockResolvedValue({
      id: 'run-3b',
      status: 'reviewing',
      filesChanged: ['apps/dashboard/src/app/page.tsx'],
      networkUsed: false,
      secretsAccessed: false,
      task: {
        riskLevel: 'low',
        requiresHumanApproval: false,
        repo: {
          highRiskPaths: ['.github/workflows/**'],
        },
      },
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
            checks: {
              unit_tests: 'passed',
              lint: 'passed',
              typecheck: 'passed',
              build: 'passed',
            },
            testWeakeningDetected: false,
          },
        },
      ],
    });
    mockPrisma.reviewResultRecord.create.mockImplementation(async ({ data }) => ({ id: 'review-3b', ...data }) as any);

    const result = await service.performReview('run-3b', 'codex');

    expect(result).toEqual(
      expect.objectContaining({
        verdict: 'requires_human_review',
      }),
    );
  });

  it('exports a PR review draft payload from the latest review result', async () => {
    mockPrisma.agentRun.findUnique.mockResolvedValue({
      id: 'run-4',
      branch: 'ai/fix-pipeline',
      pullRequestUrl: null,
      reviews: [
        {
          agentName: 'claude_code',
          verdict: 'requires_changes',
          summary: '1 blocking issue(s) detected in verification or execution signals.',
          reviewedAt: '2026-05-19T11:00:00.000Z',
          findings: [
            {
              severity: 'high',
              category: 'test_quality',
              file: 'apps/api/src/app.ts',
              message: 'Unit tests failed during verification.',
              recommendation: 'Fix failing tests before merge.',
            },
          ],
        },
      ],
      events: [
        {
          type: 'pr_draft_generated',
          data: {
            title: 'AI: Fix pipeline',
            baseBranch: 'main',
            headBranch: 'ai/fix-pipeline',
            compareUrl: 'https://github.com/newmba/CICD/compare/main...ai%2Ffix-pipeline?expand=1',
          },
        },
      ],
    });

    const result = await service.getPullRequestDraft('run-4');

    expect(result).toEqual(
      expect.objectContaining({
        runId: 'run-4',
        available: true,
        action: 'REQUEST_CHANGES',
        comments: expect.arrayContaining([
          expect.objectContaining({
            path: 'apps/api/src/app.ts',
            severity: 'high',
          }),
        ]),
        pullRequest: expect.objectContaining({
          title: 'AI: Fix pipeline',
          baseBranch: 'main',
          headBranch: 'ai/fix-pipeline',
        }),
      }),
    );
  });

  it('exports a GitHub pull request payload from the generated draft', async () => {
    mockPrisma.agentRun.findUnique.mockResolvedValue({
      id: 'run-5',
      branch: 'ai/fix-pipeline',
      pullRequestUrl: null,
      commitSha: 'abc123',
      reviews: [],
      events: [
        {
          type: 'pr_draft_generated',
          data: {
            title: 'AI: Fix pipeline',
            body: '## Summary\nFix pipeline',
            baseBranch: 'main',
            headBranch: 'ai/fix-pipeline',
            compareUrl: 'https://github.com/newmba/CICD/compare/main...ai%2Ffix-pipeline?expand=1',
          },
        },
      ],
    });

    const result = await service.getGithubPullRequestPayload('run-5');

    expect(result).toEqual(
      expect.objectContaining({
        runId: 'run-5',
        available: true,
        github: expect.objectContaining({
          title: 'AI: Fix pipeline',
          body: '## Summary\nFix pipeline',
          head: 'ai/fix-pipeline',
          base: 'main',
          draft: true,
        }),
      }),
    );
  });

  it('exports a GitHub review payload from the latest review result', async () => {
    mockPrisma.agentRun.findUnique.mockResolvedValue({
      id: 'run-6',
      branch: 'ai/fix-pipeline',
      pullRequestUrl: null,
      commitSha: 'abc123',
      reviews: [
        {
          agentName: 'claude_code',
          verdict: 'requires_changes',
          summary: '1 blocking issue(s) detected in verification or execution signals.',
          reviewedAt: '2026-05-19T11:00:00.000Z',
          findings: [
            {
              severity: 'high',
              category: 'test_quality',
              file: 'apps/api/src/app.ts',
              line: 42,
              message: 'Unit tests failed during verification.',
              recommendation: 'Fix failing tests before merge.',
            },
          ],
        },
      ],
      events: [
        {
          type: 'pr_draft_generated',
          data: {
            title: 'AI: Fix pipeline',
            body: '## Summary\nFix pipeline',
            baseBranch: 'main',
            headBranch: 'ai/fix-pipeline',
            compareUrl: 'https://github.com/newmba/CICD/compare/main...ai%2Ffix-pipeline?expand=1',
          },
        },
      ],
    });

    const result = await service.getGithubReviewPayload('run-6');

    expect(result).toEqual(
      expect.objectContaining({
        runId: 'run-6',
        available: true,
        github: expect.objectContaining({
          event: 'REQUEST_CHANGES',
          commit_id: 'abc123',
          comments: expect.arrayContaining([
            expect.objectContaining({
              path: 'apps/api/src/app.ts',
              line: 42,
              side: 'RIGHT',
            }),
          ]),
        }),
      }),
    );
  });

  it('creates a GitHub pull request and records the delivery event', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        number: 42,
        state: 'open',
        html_url: 'https://github.com/newmba/CICD/pull/42',
      }),
    } as Response) as jest.Mock;

    mockPrisma.agentRun.findUnique
      .mockResolvedValueOnce({
        id: 'run-7',
        branch: 'ai/fix-pipeline',
        pullRequestUrl: null,
        reviews: [],
        events: [
          {
            type: 'pr_draft_generated',
            data: {
              title: 'AI: Fix pipeline',
              body: '## Summary\nFix pipeline',
              baseBranch: 'main',
              headBranch: 'ai/fix-pipeline',
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        id: 'run-7',
        pullRequestUrl: null,
        task: {
          repo: {
            fullName: 'newmba/CICD',
          },
        },
      });
    mockPrisma.agentRun.update.mockResolvedValue({ id: 'run-7' });
    mockPrisma.agentEventRecord.create.mockResolvedValue({ id: 'event-1' });

    const result = await service.createGithubPullRequest('run-7');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.github.test/repos/newmba/CICD/pulls',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    expect(mockPrisma.agentRun.update).toHaveBeenCalledWith({
      where: { id: 'run-7' },
      data: {
        pullRequestUrl: 'https://github.com/newmba/CICD/pull/42',
      },
    });
    expect(mockPrisma.agentEventRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        runId: 'run-7',
        type: 'github_pull_request_created',
      }),
    });
    expect(result).toEqual(
      expect.objectContaining({
        created: true,
        pullRequestUrl: 'https://github.com/newmba/CICD/pull/42',
        number: 42,
      }),
    );
  });

  it('submits a GitHub review to the existing pull request', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 501,
        state: 'PENDING',
        html_url: 'https://github.com/newmba/CICD/pull/42#pullrequestreview-501',
      }),
    } as Response) as jest.Mock;

    mockPrisma.agentRun.findUnique
      .mockResolvedValueOnce({
        id: 'run-8',
        branch: 'ai/fix-pipeline',
        pullRequestUrl: 'https://github.com/newmba/CICD/pull/42',
        commitSha: 'abc123',
        reviews: [
          {
            agentName: 'claude_code',
            verdict: 'requires_changes',
            summary: '1 blocking issue(s) detected in verification or execution signals.',
            reviewedAt: '2026-05-19T11:00:00.000Z',
            findings: [
              {
                severity: 'high',
                category: 'test_quality',
                file: 'apps/api/src/app.ts',
                line: 42,
                message: 'Unit tests failed during verification.',
                recommendation: 'Fix failing tests before merge.',
              },
            ],
          },
        ],
        events: [
          {
            type: 'pr_draft_generated',
            data: {
              title: 'AI: Fix pipeline',
              body: '## Summary\nFix pipeline',
              baseBranch: 'main',
              headBranch: 'ai/fix-pipeline',
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        id: 'run-8',
        pullRequestUrl: 'https://github.com/newmba/CICD/pull/42',
        task: {
          repo: {
            fullName: 'newmba/CICD',
          },
        },
      });
    mockPrisma.agentEventRecord.create.mockResolvedValue({ id: 'event-2' });

    const result = await service.submitGithubReview('run-8');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.github.test/repos/newmba/CICD/pulls/42/reviews',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    expect(mockPrisma.agentEventRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        runId: 'run-8',
        type: 'github_review_submitted',
      }),
    });
    expect(result).toEqual(
      expect.objectContaining({
        submitted: true,
        reviewId: 501,
      }),
    );
  });
});
