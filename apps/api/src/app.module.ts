import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module.js';
import { RepoModule } from './modules/repo/repo.module.js';
import { AgentModule } from './modules/agent/agent.module.js';
import { ContextModule } from './modules/context/context.module.js';
import { IntentGateModule } from './modules/intent-gate/intent-gate.module.js';
import { PolicyModule } from './modules/policy/policy.module.js';
import { RunnerModule } from './modules/runner/runner.module.js';
import { OrchestratorModule } from './modules/orchestrator/orchestrator.module.js';
import { VerificationModule } from './modules/verification/verification.module.js';
import { ReviewModule } from './modules/review/review.module.js';
import { RepairModule } from './modules/repair/repair.module.js';
import { EvidenceModule } from './modules/evidence/evidence.module.js';
import { ReleaseModule } from './modules/release/release.module.js';
import { WebhookModule } from './modules/webhook/webhook.module.js';

@Module({
  imports: [
    ConfigModule,
    RepoModule,
    AgentModule,
    ContextModule,
    IntentGateModule,
    PolicyModule,
    RunnerModule,
    OrchestratorModule,
    VerificationModule,
    ReviewModule,
    RepairModule,
    EvidenceModule,
    ReleaseModule,
    WebhookModule,
  ],
})
export class AppModule {}
