import { Module } from '@nestjs/common';
import { RepoController } from './repo.controller.js';
import { RepoService } from './repo.service.js';
import { RepoOnboardingService } from './repo-onboarding.service.js';
import { LanguageDetectorService } from './language-detector.service.js';
import { HighRiskPathService } from './high-risk-path.service.js';
import { WorkflowGeneratorService } from './workflow-generator.service.js';

@Module({
  controllers: [RepoController],
  providers: [
    RepoService,
    RepoOnboardingService,
    LanguageDetectorService,
    HighRiskPathService,
    WorkflowGeneratorService,
  ],
  exports: [RepoService, RepoOnboardingService, HighRiskPathService, WorkflowGeneratorService],
})
export class RepoModule {}
