import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module.js';
import { ContextModule } from '../context/context.module.js';
import { EvidenceModule } from '../evidence/evidence.module.js';
import { PolicyModule } from '../policy/policy.module.js';
import { RepairModule } from '../repair/repair.module.js';
import { RepoModule } from '../repo/repo.module.js';
import { ReviewModule } from '../review/review.module.js';
import { RunnerModule } from '../runner/runner.module.js';
import { VerificationModule } from '../verification/verification.module.js';
import { OrchestratorController } from './orchestrator.controller.js';
import { OrchestratorService } from './orchestrator.service.js';

@Module({
  imports: [
    AgentModule,
    ContextModule,
    EvidenceModule,
    PolicyModule,
    RepairModule,
    RepoModule,
    ReviewModule,
    RunnerModule,
    VerificationModule,
  ],
  controllers: [OrchestratorController],
  providers: [OrchestratorService],
  exports: [OrchestratorService],
})
export class OrchestratorModule {}
