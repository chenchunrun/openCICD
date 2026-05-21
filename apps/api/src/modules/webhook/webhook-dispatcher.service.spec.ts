const mockPrisma = {
  repository: {
    findUnique: jest.fn(),
  },
};

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn(() => mockPrisma),
}));

import { WebhookDispatcherService } from './webhook-dispatcher.service';
import type { IntentGateService } from '../intent-gate/intent-gate.service';
import type { OrchestratorService } from '../orchestrator/orchestrator.service';

describe('WebhookDispatcherService', () => {
  let service: WebhookDispatcherService;
  let intentGateServiceMock: jest.Mocked<IntentGateService>;
  let orchestratorServiceMock: jest.Mocked<OrchestratorService>;

  beforeEach(() => {
    jest.clearAllMocks();

    intentGateServiceMock = {
      processTask: jest.fn(),
    } as unknown as jest.Mocked<IntentGateService>;

    orchestratorServiceMock = {
      scheduleTask: jest.fn(),
    } as unknown as jest.Mocked<OrchestratorService>;

    service = new WebhookDispatcherService(intentGateServiceMock, orchestratorServiceMock);
  });

  it('creates and schedules a task for /ai run issue comments', async () => {
    mockPrisma.repository.findUnique.mockResolvedValue({
      id: 'repo-1',
      fullName: 'newmba/CICD',
    });
    intentGateServiceMock.processTask.mockResolvedValue({ id: 'task-1' } as any);
    orchestratorServiceMock.scheduleTask.mockResolvedValue({
      taskId: 'task-1',
      status: 'accepted',
    });

    const result = await service.dispatch({
      eventType: 'issue_comment',
      action: 'created',
      repoFullName: 'newmba/CICD',
      payload: {
        comment: { body: '/ai run' },
        issue: { title: 'Fix failing pipeline' },
      },
    });

    expect(intentGateServiceMock.processTask).toHaveBeenCalledWith(
      expect.objectContaining({
        repoId: 'repo-1',
        goal: 'Fix failing pipeline',
      }),
    );
    expect(orchestratorServiceMock.scheduleTask).toHaveBeenCalledWith('task-1');
    expect(result).toEqual({ dispatched: true, target: 'orchestrator' });
  });
});
