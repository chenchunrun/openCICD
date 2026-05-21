import { Controller, Get, Param } from '@nestjs/common';
import { RepairService } from './repair.service.js';

@Controller('repairs')
export class RepairController {
  constructor(private readonly repairService: RepairService) {}

  @Get('run/:runId')
  async getRunRepairs(@Param('runId') runId: string) {
    return this.repairService.getRepairsForRun(runId);
  }
}
