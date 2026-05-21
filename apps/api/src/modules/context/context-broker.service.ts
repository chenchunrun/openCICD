import { Injectable } from '@nestjs/common';
import type { AgentTaskContext, EffectivePolicy } from '@aicp/shared';

type BrokerTaskInput = {
  id: string;
  goal: string;
  doneWhen: string[];
  constraints: string[];
  scope: unknown;
  sourceType: string;
  riskLevel?: string;
  requiresHumanApproval?: boolean;
};

type BrokerRepoInput = {
  fullName: string | null;
  localPath: string | null;
};

@Injectable()
export class ContextBrokerService {
  buildAgentTaskContext(task: BrokerTaskInput, repo: BrokerRepoInput): AgentTaskContext {
    const scope = task.scope && typeof task.scope === 'object' ? (task.scope as Record<string, unknown>) : {};
    const allowedPaths = Array.isArray(scope.allowedPaths)
      ? scope.allowedPaths.filter((entry): entry is string => typeof entry === 'string')
      : [];
    const forbiddenPaths = Array.isArray(scope.forbiddenPaths)
      ? scope.forbiddenPaths.filter((entry): entry is string => typeof entry === 'string')
      : [];

    return {
      taskId: task.id,
      goal: task.goal,
      allowedPaths,
      forbiddenPaths,
      doneWhen: task.doneWhen,
      constraints: task.constraints,
      repoFullName: repo.fullName,
      repoLocalPath: repo.localPath,
    };
  }

  buildContextSummary(
    task: BrokerTaskInput,
    repo: BrokerRepoInput,
    policy: EffectivePolicy,
    taskContext: AgentTaskContext,
  ): Record<string, unknown> {
    return {
      taskId: task.id,
      sourceType: task.sourceType,
      riskLevel: task.riskLevel ?? 'unknown',
      repo: {
        fullName: repo.fullName,
        hasLocalPath: Boolean(repo.localPath),
      },
      scope: {
        allowedPaths: taskContext.allowedPaths,
        forbiddenPaths: taskContext.forbiddenPaths,
      },
      successCriteria: {
        doneWhen: taskContext.doneWhen,
        constraints: taskContext.constraints,
      },
      enforcement: {
        filesystem: policy.filesystem,
        networkMode: policy.network.mode,
        networkDomains: policy.network.domains,
        secretsMode: policy.secrets.mode,
      },
      trustBoundaries: {
        requiresHumanApproval: task.requiresHumanApproval ?? false,
        hasPathRestrictions:
          taskContext.allowedPaths.length > 0 || taskContext.forbiddenPaths.length > 0,
        offlineByDefault: policy.network.mode === 'disabled',
      },
    };
  }
}
