import { Module } from '@nestjs/common';
import { PolicyController } from './policy.controller.js';
import { PolicyService } from './policy.service.js';
import { PolicyResolverService } from './policy-resolver.service.js';
import { PolicyFileChangeDetectorService } from './policy-file-change-detector.service.js';

@Module({
  controllers: [PolicyController],
  providers: [PolicyService, PolicyResolverService, PolicyFileChangeDetectorService],
  exports: [PolicyService, PolicyResolverService, PolicyFileChangeDetectorService],
})
export class PolicyModule {}
