import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { RunnerService } from './runner.service.js';

@Controller('runs')
export class RunnerController {
  constructor(private readonly runnerService: RunnerService) {}

  @Post()
  async createRun(@Body() body: { taskId: string; agentName?: string }) {
    return this.runnerService.createRun(body.taskId, body.agentName);
  }

  @Get()
  async listRuns() {
    return this.runnerService.listRuns();
  }

  @Get(':id')
  async getRun(@Param('id') id: string) {
    return this.runnerService.getRun(id);
  }

  @Get(':id/events')
  async getRunEvents(@Param('id') id: string) {
    return this.runnerService.getRunEvents(id);
  }

  @Get(':id/diff')
  async getRunDiff(@Param('id') id: string) {
    return this.runnerService.getRunDiff(id);
  }

  @Post(':id/stop')
  async stopRun(@Param('id') id: string) {
    return this.runnerService.stopRun(id);
  }
}
