import { Module } from '@nestjs/common';
import { IntentGateController } from './intent-gate.controller.js';
import { IntentGateService } from './intent-gate.service.js';
import { TaskNormalizerService } from './task-normalizer.service.js';
import { CompletenessValidatorService } from './completeness-validator.service.js';
import { RiskClassifierService } from './risk-classifier.service.js';
import { PromptInjectionDetectorService } from './prompt-injection-detector.service.js';

@Module({
  controllers: [IntentGateController],
  providers: [
    IntentGateService,
    TaskNormalizerService,
    CompletenessValidatorService,
    RiskClassifierService,
    PromptInjectionDetectorService,
  ],
  exports: [IntentGateService],
})
export class IntentGateModule {}
