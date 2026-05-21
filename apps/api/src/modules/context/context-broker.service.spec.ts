import { ContextBrokerService } from './context-broker.service.js';

describe('ContextBrokerService', () => {
  const service = new ContextBrokerService();

  it('builds a normalized agent task context and trust summary', () => {
    const taskContext = service.buildAgentTaskContext(
      {
        id: 'task-1',
        goal: 'Fix verification flow',
        sourceType: 'manual',
        riskLevel: 'medium',
        doneWhen: ['Verification passes'],
        constraints: ['Do not modify infra'],
        requiresHumanApproval: true,
        scope: {
          allowedPaths: ['apps/api/src/**', 1, null],
          forbiddenPaths: ['infra/**', false],
        },
      },
      {
        fullName: 'newmba/CICD',
        localPath: '/Users/newmba/CICD',
      },
    );

    expect(taskContext).toEqual({
      taskId: 'task-1',
      goal: 'Fix verification flow',
      allowedPaths: ['apps/api/src/**'],
      forbiddenPaths: ['infra/**'],
      doneWhen: ['Verification passes'],
      constraints: ['Do not modify infra'],
      repoFullName: 'newmba/CICD',
      repoLocalPath: '/Users/newmba/CICD',
    });

    const summary = service.buildContextSummary(
      {
        id: 'task-1',
        goal: 'Fix verification flow',
        sourceType: 'manual',
        riskLevel: 'medium',
        doneWhen: ['Verification passes'],
        constraints: ['Do not modify infra'],
        requiresHumanApproval: true,
        scope: {
          allowedPaths: ['apps/api/src/**'],
          forbiddenPaths: ['infra/**'],
        },
      },
      {
        fullName: 'newmba/CICD',
        localPath: '/Users/newmba/CICD',
      },
      {
        filesystem: 'read_only',
        allowedPaths: ['apps/api/src/**'],
        forbiddenPaths: ['infra/**'],
        allowedCommands: [],
        deniedCommands: [],
        network: { mode: 'disabled', domains: [], methods: [] },
        secrets: { mode: 'none', refs: [] },
        mcp: { allowedServers: [], deniedServers: [] },
      },
      taskContext,
    );

    expect(summary).toEqual(
      expect.objectContaining({
        taskId: 'task-1',
        sourceType: 'manual',
        riskLevel: 'medium',
        enforcement: expect.objectContaining({
          filesystem: 'read_only',
          networkMode: 'disabled',
          secretsMode: 'none',
        }),
        trustBoundaries: expect.objectContaining({
          requiresHumanApproval: true,
          hasPathRestrictions: true,
          offlineByDefault: true,
        }),
      }),
    );
  });
});
