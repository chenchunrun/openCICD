import { Module } from '@nestjs/common';
import { EvidenceController } from './evidence.controller.js';
import { EvidenceService } from './evidence.service.js';
import { EvidenceGeneratorService } from './evidence-generator.service.js';

@Module({
  controllers: [EvidenceController],
  providers: [EvidenceService, EvidenceGeneratorService],
  exports: [EvidenceService, EvidenceGeneratorService],
})
export class EvidenceModule {}
