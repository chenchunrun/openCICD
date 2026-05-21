import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module.js';
import { ConfigModule } from '../../config/config.module.js';
import { ReviewController } from './review.controller.js';
import { ReviewService } from './review.service.js';
import { ReviewGateService } from './review-gate.service.js';

@Module({
  imports: [AgentModule, ConfigModule],
  controllers: [ReviewController],
  providers: [ReviewService, ReviewGateService],
  exports: [ReviewService, ReviewGateService],
})
export class ReviewModule {}
