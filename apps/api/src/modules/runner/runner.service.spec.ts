const mockPrisma = {
  agentTask: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  agentRun: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  agentEventRecord: {
    create: jest.fn(),
    findMany: jest.fn(),
  },
};

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn(() => mockPrisma),
}));

import { ConflictException, NotFoundException } from '@nestjs/common';
import type { AgentService } from '../agent/agent.service';
import { RunnerService } from './runner.service';

describe('RunnerService', () => {
  let service: RunnerService;
  let agentServiceMock: jest.Mocked<AgentService>;

  beforeEach(() => {
    jest.clearAllMocks();

    agentServiceMock = {
      stop: jest.fn(),
    } as unknown as jest.Mocked<AgentService>;

    service = new RunnerService(agentServiceMock);
  });

  describe('stopRun', () => {
    it('stops an active run, writes an event, and syncs the task status', async () => {
      mockPrisma.agentRun.findUnique.mockResolvedValue({
        id: 'run-1',
        taskId: 'task-1',
        agentName: 'codex',
        status: 'running',
        task: {
          id: 'task-1',
          status: 'in_progress',
        },
      });
      mockPrisma.agentEventRecord.create.mockResolvedValue({ id: 'event-1' });
      mockPrisma.agentRun.update.mockResolvedValue({ id: 'run-1', status: 'stopped' });
      mockPrisma.agentTask.update.mockResolvedValue({ id: 'task-1', status: 'stopped' });

      const result = await service.stopRun('run-1');

      expect(agentServiceMock.stop).toHaveBeenCalledWith('codex', 'run-1');
      expect(mockPrisma.agentEventRecord.create).toHaveBeenCalledWith({
        data: {
          runId: 'run-1',
          type: 'run_stopped',
          data: {
            message: 'Run stop requested by user',
          },
        },
      });
      expect(mockPrisma.agentRun.update).toHaveBeenCalledWith({
        where: { id: 'run-1' },
        data: {
          status: 'stopped',
          finishedAt: expect.any(Date),
        },
      });
      expect(mockPrisma.agentTask.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: { status: 'stopped' },
      });
      expect(result).toEqual({ id: 'run-1', status: 'stopped' });
    });

    it('throws not found when the run does not exist', async () => {
      mockPrisma.agentRun.findUnique.mockResolvedValue(null);

      await expect(service.stopRun('missing-run')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws conflict when the run is already terminal', async () => {
      mockPrisma.agentRun.findUnique.mockResolvedValue({
        id: 'run-1',
        taskId: 'task-1',
        agentName: 'codex',
        status: 'completed',
        task: {
          id: 'task-1',
          status: 'completed',
        },
      });

      await expect(service.stopRun('run-1')).rejects.toBeInstanceOf(ConflictException);
      expect(agentServiceMock.stop).not.toHaveBeenCalled();
    });
  });

  describe('onModuleInit', () => {
    it('marks active runs as failed after a restart and records recovery events', async () => {
      mockPrisma.agentRun.findMany.mockResolvedValue([
        {
          id: 'run-1',
          taskId: 'task-1',
          status: 'verifying',
          finishedAt: null,
          task: {
            id: 'task-1',
            status: 'in_progress',
          },
        },
      ]);
      mockPrisma.agentEventRecord.create.mockResolvedValue({ id: 'event-1' });
      mockPrisma.agentRun.update.mockResolvedValue({ id: 'run-1', status: 'failed' });
      mockPrisma.agentTask.update.mockResolvedValue({ id: 'task-1', status: 'failed' });

      await service.onModuleInit();

      expect(mockPrisma.agentEventRecord.create).toHaveBeenCalledWith({
        data: {
          runId: 'run-1',
          type: 'orphaned_run_recovered',
          data: {
            message: 'Run was left active when the API process restarted and has been marked failed',
            previousStatus: 'verifying',
          },
        },
      });
      expect(mockPrisma.agentRun.update).toHaveBeenCalledWith({
        where: { id: 'run-1' },
        data: {
          status: 'failed',
          finishedAt: expect.any(Date),
        },
      });
      expect(mockPrisma.agentTask.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: { status: 'failed' },
      });
    });
  });
});
