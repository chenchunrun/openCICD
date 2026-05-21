import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { TaskNormalizerService } from './task-normalizer.service.js';
import { CompletenessValidatorService } from './completeness-validator.service.js';
import { RiskClassifierService } from './risk-classifier.service.js';
import { PromptInjectionDetectorService } from './prompt-injection-detector.service.js';

const prisma = new PrismaClient();

export interface ProcessTaskInput {
  repoId: string;
  source: { type: string; url?: string; payload?: Record<string, unknown> };
  goal: string;
  scope: { allowedPaths: string[]; forbiddenPaths: string[] };
  doneWhen: string[];
  constraints?: string[];
  preferredAgent?: string;
}

@Injectable()
export class IntentGateService {
  constructor(
    _taskNormalizer: TaskNormalizerService,
    private readonly completenessValidator: CompletenessValidatorService,
    private readonly riskClassifier: RiskClassifierService,
    private readonly injectionDetector: PromptInjectionDetectorService,
  ) {}

  async processTask(input: ProcessTaskInput) {
    const repo = await prisma.repository.findUnique({ where: { id: input.repoId } });
    if (!repo) {
      throw new NotFoundException(`Repository not found: ${input.repoId}`);
    }

    const goalText = `${input.goal} ${(input.constraints ?? []).join(' ')}`;
    const injectionResult = this.injectionDetector.detect(goalText);
    if (injectionResult.detected) {
      throw new BadRequestException(
        `Prompt injection detected: ${injectionResult.matchedPatterns.join(', ')}`,
      );
    }

    const validation = this.completenessValidator.validate(input);
    if (!validation.valid) {
      throw new BadRequestException(`Task validation failed: ${validation.errors.join('; ')}`);
    }

    const risk = this.riskClassifier.classify(input.goal, input.scope, input.constraints ?? []);

    return prisma.agentTask.create({
      data: {
        repoId: input.repoId,
        sourceType: input.source.type as 'manual',
        sourceUrl: input.source.url,
        sourcePayload: (input.source.payload ?? undefined) as any,
        goal: input.goal,
        scope: input.scope,
        constraints: input.constraints ?? [],
        doneWhen: input.doneWhen,
        riskLevel: risk.level,
        riskReasons: risk.reasons,
        preferredAgent: input.preferredAgent,
        status: risk.level === 'critical' ? 'pending' : 'pending',
      },
    });
  }

  async listTasks() {
    return prisma.agentTask.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async getTask(id: string) {
    const task = await prisma.agentTask.findUnique({
      where: { id },
      include: { runs: true, approvals: true, evidences: true },
    });
    if (!task) {
      throw new NotFoundException(`Task not found: ${id}`);
    }
    return task;
  }

  async approveTask(id: string, approver: string, reason?: string) {
    const task = await prisma.agentTask.findUnique({ where: { id } });
    if (!task) {
      throw new NotFoundException(`Task not found: ${id}`);
    }
    await prisma.taskApproval.create({
      data: { taskId: id, action: 'approved', approver, reason },
    });
    return prisma.agentTask.update({
      where: { id },
      data: { status: 'approved' },
    });
  }

  async rejectTask(id: string, approver: string, reason: string) {
    const task = await prisma.agentTask.findUnique({ where: { id } });
    if (!task) {
      throw new NotFoundException(`Task not found: ${id}`);
    }
    await prisma.taskApproval.create({
      data: { taskId: id, action: 'rejected', approver, reason },
    });
    return prisma.agentTask.update({
      where: { id },
      data: { status: 'rejected' },
    });
  }
}
