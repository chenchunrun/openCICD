import { Module } from '@nestjs/common';
import { ReviewModule } from '../review/review.module.js';
import { ReleaseController } from './release.controller.js';
import { ReleaseService } from './release.service.js';

@Module({
  imports: [ReviewModule],
  controllers: [ReleaseController],
  providers: [ReleaseService],
  exports: [ReleaseService],
})
export class ReleaseModule {}
