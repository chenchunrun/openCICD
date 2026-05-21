import { Module } from '@nestjs/common';
import { RepairController } from './repair.controller.js';
import { RepairService } from './repair.service.js';
import { FailureClassifierService } from './failure-classifier.service.js';

@Module({
  controllers: [RepairController],
  providers: [RepairService, FailureClassifierService],
  exports: [RepairService, FailureClassifierService],
})
export class RepairModule {}
