import { Injectable, Logger } from '@nestjs/common';
import { IntentGateService } from '../intent-gate/intent-gate.service.js';
import { OrchestratorService } from '../orchestrator/orchestrator.service.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

@Injectable()
export class WebhookDispatcherService {
  private readonly logger = new Logger(WebhookDispatcherService.name);

  constructor(
    private readonly intentGateService: IntentGateService,
    private readonly orchestratorService: OrchestratorService,
  ) {}

  async dispatch(event: {
    eventType: string;
    action: string;
    repoFullName: string;
    payload: Record<string, unknown>;
  }): Promise<{ dispatched: boolean; target: string }> {
    this.logger.log(`Dispatching ${event.eventType}.${event.action} for ${event.repoFullName}`);

    const repo = await prisma.repository.findUnique({
      where: { fullName: event.repoFullName },
    });

    if (!repo) {
      this.logger.warn(`Repository not found: ${event.repoFullName}`);
      return { dispatched: false, target: 'unknown_repo' };
    }

    if (event.eventType === 'issues' && (event.action === 'opened' || event.action === 'edited')) {
      const issue = event.payload as Record<string, unknown>;
      const issueData = issue.issue as Record<string, unknown> ?? {};
      const title = issueData.title as string ?? '';
      const htmlUrl = issueData.html_url as string ?? '';

      await this.intentGateService.processTask({
        repoId: repo.id,
        source: { type: 'github_issue', url: htmlUrl, payload: event.payload },
        goal: title,
        scope: { allowedPaths: ['src/**', 'tests/**'], forbiddenPaths: ['infra/**'] },
        doneWhen: ['All tests pass', 'Code reviewed'],
      });

      return { dispatched: true, target: 'intent_gate' };
    }

    if (event.eventType === 'issue_comment' && event.action === 'created') {
      const comment = (event.payload as Record<string, unknown>).comment as Record<string, unknown> | undefined;
      const commentBody = (comment?.body as string) ?? '';

      if (commentBody.includes('/ai run') || commentBody.includes('/ai plan')) {
        const issue = (event.payload as Record<string, unknown>).issue as Record<string, unknown> | undefined;
        const title = (issue?.title as string) ?? '';

        const task = await this.intentGateService.processTask({
          repoId: repo.id,
          source: { type: 'github_issue', payload: event.payload },
          goal: title,
          scope: { allowedPaths: ['src/**', 'tests/**'], forbiddenPaths: ['infra/**'] },
          doneWhen: ['All tests pass'],
        });

        await this.orchestratorService.scheduleTask(task.id);

        return { dispatched: true, target: 'orchestrator' };
      }
    }

    if (event.eventType === 'workflow_run' && event.action === 'completed') {
      const workflowRun = (event.payload as Record<string, unknown>).workflow_run as Record<string, unknown> | undefined;
      const conclusion = workflowRun?.conclusion as string | undefined;

      if (conclusion === 'failure') {
        return { dispatched: true, target: 'repair' };
      }
    }

    this.logger.log(`No handler for ${event.eventType}.${event.action}`);
    return { dispatched: false, target: 'no_handler' };
  }
}
