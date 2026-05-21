import { ConflictException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PrismaClient, RunStatus } from '@prisma/client';
import { AgentService } from '../agent/agent.service.js';

const prisma = new PrismaClient();
const ACTIVE_RUN_STATUSES: RunStatus[] = [
  'queued',
  'preparing',
  'running',
  'verifying',
  'reviewing',
  'repairing',
  'waiting_approval',
];

@Injectable()
export class RunnerService implements OnModuleInit {
  private readonly logger = new Logger(RunnerService.name);

  constructor(private readonly agentService: AgentService) {}

  async onModuleInit(): Promise<void> {
    await this.recoverOrphanedRuns();
  }

  async createRun(taskId: string, agentName?: string) {
    const task = await prisma.agentTask.findUnique({ where: { id: taskId } });
    if (!task) throw new Error(`Task not found: ${taskId}`);

    const agent = agentName ?? task.preferredAgent ?? 'claude_code';

    return prisma.agentRun.create({
      data: {
        taskId,
        agentName: agent,
        executionMode: 'cli',
        status: 'queued',
        branch: `ai/task-${taskId.substring(0, 8)}`,
      },
    });
  }

  async listRuns() {
    return prisma.agentRun.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        task: {
          select: {
            filesystemMode: true,
            networkMode: true,
            networkDomains: true,
            secretsMode: true,
          },
        },
        events: {
          where: {
            type: {
              in: ['error', 'verification_completed'],
            },
          },
          orderBy: { timestamp: 'desc' },
          take: 2,
        },
        repairs: {
          orderBy: { loopNumber: 'desc' },
          take: 1,
        },
        _count: {
          select: {
            repairs: true,
          },
        },
      },
    });
  }

  async getRun(id: string) {
    return prisma.agentRun.findUnique({
      where: { id },
      include: {
        events: { orderBy: { timestamp: 'asc' } },
        repairs: { orderBy: { loopNumber: 'asc' } },
        reviews: true,
        task: {
          select: {
            filesystemMode: true,
            networkMode: true,
            networkDomains: true,
            secretsMode: true,
            allowedPaths: true,
            forbiddenPaths: true,
          },
        },
      },
    });
  }

  async getRunEvents(id: string) {
    return prisma.agentEventRecord.findMany({
      where: { runId: id },
      orderBy: { timestamp: 'asc' },
    });
  }

  async getRunDiff(id: string) {
    const run = await prisma.agentRun.findUnique({ where: { id } });
    return {
      diff: run?.diffFull ?? '',
      summary: run?.diffSummary ?? {},
    };
  }

  async stopRun(id: string) {
    const run = await prisma.agentRun.findUnique({
      where: { id },
      include: {
        task: true,
      },
    });
    if (!run) {
      throw new NotFoundException(`Run not found: ${id}`);
    }

    if (!ACTIVE_RUN_STATUSES.includes(run.status)) {
      throw new ConflictException(`Run ${id} is not stoppable from status ${run.status}`);
    }

    await this.agentService.stop(run.agentName, run.id);
    await prisma.agentEventRecord.create({
      data: {
        runId: run.id,
        type: 'run_stopped',
        data: {
          message: 'Run stop requested by user',
        },
      } as any,
    });

    const stoppedRun = await prisma.agentRun.update({
      where: { id },
      data: { status: 'stopped', finishedAt: new Date() },
    });

    if (['queued', 'in_progress'].includes(run.task.status)) {
      await prisma.agentTask.update({
        where: { id: run.taskId },
        data: { status: 'stopped' },
      });
    }

    return stoppedRun;
  }

  async updateRunStatus(id: string, status: string, data?: Record<string, unknown>) {
    return prisma.agentRun.update({
      where: { id },
      data: { status: status as RunStatus, ...data } as any,
    });
  }

  async addEvent(runId: string, type: string, data: Record<string, unknown>) {
    return prisma.agentEventRecord.create({
      data: { runId, type, data } as any,
    });
  }

  private async recoverOrphanedRuns(): Promise<void> {
    const activeRuns = await prisma.agentRun.findMany({
      where: {
        status: {
          in: ACTIVE_RUN_STATUSES,
        },
      },
      include: {
        task: true,
      },
    });

    if (activeRuns.length === 0) {
      return;
    }

    this.logger.warn(`Recovering ${activeRuns.length} orphaned run(s) left active after process restart`);

    for (const run of activeRuns) {
      await prisma.agentEventRecord.create({
        data: {
          runId: run.id,
          type: 'orphaned_run_recovered',
          data: {
            message: 'Run was left active when the API process restarted and has been marked failed',
            previousStatus: run.status,
          },
        } as any,
      });

      await prisma.agentRun.update({
        where: { id: run.id },
        data: {
          status: 'failed',
          finishedAt: run.finishedAt ?? new Date(),
        },
      });

      if (['queued', 'in_progress'].includes(run.task.status)) {
        await prisma.agentTask.update({
          where: { id: run.taskId },
          data: { status: 'failed' },
        });
      }
    }
  }
}
