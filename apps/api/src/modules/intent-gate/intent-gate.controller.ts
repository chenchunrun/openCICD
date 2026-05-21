import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { IntentGateService } from './intent-gate.service.js';
import { ApproveTaskDto } from './dto/approve-task.dto.js';
import { CreateTaskDto } from './dto/create-task.dto.js';
import { RejectTaskDto } from './dto/reject-task.dto.js';

@Controller('tasks')
export class IntentGateController {
  constructor(private readonly intentGateService: IntentGateService) {}

  @Post()
  async createTask(@Body() body: CreateTaskDto) {
    return this.intentGateService.processTask({
      ...body,
      scope: {
        allowedPaths: body.scope.allowedPaths,
        forbiddenPaths: body.scope.forbiddenPaths ?? [],
      },
    });
  }

  @Get()
  async listTasks() {
    return this.intentGateService.listTasks();
  }

  @Get(':id')
  async getTask(@Param('id') id: string) {
    return this.intentGateService.getTask(id);
  }

  @Post(':id/approve')
  async approveTask(@Param('id') id: string, @Body() body: ApproveTaskDto) {
    return this.intentGateService.approveTask(id, body.approver, body.reason);
  }

  @Post(':id/reject')
  async rejectTask(@Param('id') id: string, @Body() body: RejectTaskDto) {
    return this.intentGateService.rejectTask(id, body.approver, body.reason);
  }
}
