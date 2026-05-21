import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface ReviewGateResult {
  canMerge: boolean;
  blockers: string[];
  warnings: string[];
}

@Injectable()
export class ReviewGateService {
  async evaluate(taskId: string, runId: string): Promise<ReviewGateResult> {
    const blockers: string[] = [];
    const warnings: string[] = [];

    const reviews = await prisma.reviewResultRecord.findMany({ where: { runId } });
    const highFindings = reviews.some((r) => {
      const findings = r.findings as Array<{ severity: string }>;
      return findings.some((f) => f.severity === 'high' || f.severity === 'critical');
    });

    if (highFindings) {
      blockers.push('High severity findings in AI review');
    }

    const task = await prisma.agentTask.findUnique({ where: { id: taskId } });
    if (task?.riskLevel === 'high' || task?.riskLevel === 'critical') {
      const approvals = await prisma.taskApproval.findMany({
        where: { taskId, action: 'approved' },
      });
      if (approvals.length === 0) {
        blockers.push('Code owner approval required for high-risk changes');
      }
    }

    const evidences = await prisma.evidence.findMany({ where: { taskId } });
    if (evidences.length === 0) {
      blockers.push('Evidence must be generated before merge');
    }

    if (task?.riskLevel === 'high') {
      warnings.push('Security review recommended for high-risk changes');
    }

    return {
      canMerge: blockers.length === 0,
      blockers,
      warnings,
    };
  }
}
