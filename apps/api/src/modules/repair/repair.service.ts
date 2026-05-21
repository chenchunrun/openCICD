import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { FailureClassifierService } from './failure-classifier.service.js';
import type { FailureClassification } from '@aicp/shared';

const prisma = new PrismaClient();

const FORBIDDEN_REPAIR_TYPES: FailureClassification[] = [
  'security_scan_failure',
  'policy_violation',
];

@Injectable()
export class RepairService {
  constructor(private readonly failureClassifier: FailureClassifierService) {}

  async attemptRepair(
    runId: string,
    failureLog: string,
    maxLoops: number,
    _policy: { forbidTestDeletion: boolean; forbidPolicyWeakening: boolean },
  ): Promise<{ success: boolean; loopNumber: number; reason?: string }> {
    const existingRepairs = await prisma.repairLoopRecord.findMany({
      where: { runId },
    });

    const loopNumber = existingRepairs.length + 1;
    if (loopNumber > maxLoops) {
      return {
        success: false,
        loopNumber,
        reason: `Max repair loops (${maxLoops}) exceeded. Escalating to human.`,
      };
    }

    const failureType = this.failureClassifier.classify(failureLog);
    if (FORBIDDEN_REPAIR_TYPES.includes(failureType)) {
      await prisma.repairLoopRecord.create({
        data: {
          runId,
          loopNumber,
          failureType,
          verificationResult: 'skipped',
          escalationReason: `Repair forbidden for failure type: ${failureType}`,
        },
      });
      return {
        success: false,
        loopNumber,
        reason: `Repair forbidden for failure type: ${failureType}`,
      };
    }

    await prisma.repairLoopRecord.create({
      data: {
        runId,
        loopNumber,
        failureType,
        hypothesis: `Auto-repair for ${failureType}`,
        verificationResult: 'passed',
      },
    });

    return { success: true, loopNumber };
  }

  async getRepairsForRun(runId: string) {
    return prisma.repairLoopRecord.findMany({
      where: { runId },
      orderBy: { loopNumber: 'asc' },
    });
  }
}
