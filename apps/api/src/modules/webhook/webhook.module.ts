import { Module } from '@nestjs/common';
import { ConfigModule } from '../../config/config.module.js';
import { IntentGateModule } from '../intent-gate/intent-gate.module.js';
import { OrchestratorModule } from '../orchestrator/orchestrator.module.js';
import { WebhookController } from './webhook.controller.js';
import { GithubWebhookService } from './github-webhook.service.js';
import { WebhookDispatcherService } from './webhook-dispatcher.service.js';

@Module({
  imports: [ConfigModule, IntentGateModule, OrchestratorModule],
  controllers: [WebhookController],
  providers: [GithubWebhookService, WebhookDispatcherService],
  exports: [WebhookDispatcherService],
})
export class WebhookModule {}
