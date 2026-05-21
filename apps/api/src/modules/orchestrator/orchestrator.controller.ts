import { Controller, Param, Post } from '@nestjs/common';
import { OrchestratorService } from './orchestrator.service.js';

@Controller('orchestrator')
export class OrchestratorController {
  constructor(private readonly orchestratorService: OrchestratorService) {}

  @Post('tasks/:taskId/execute')
  async executeTask(@Param('taskId') taskId: string) {
    return this.orchestratorService.scheduleTask(taskId);
  }
}
