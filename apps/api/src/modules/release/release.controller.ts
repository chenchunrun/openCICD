import { Controller, Post, Body, Get, Param } from '@nestjs/common';
import { ReleaseService } from './release.service.js';

@Controller('release')
export class ReleaseController {
  constructor(private readonly releaseService: ReleaseService) {}

  @Post('gate')
  async evaluateReleaseGate(@Body() body: { taskId: string }) {
    return this.releaseService.evaluateGate(body.taskId);
  }

  @Post('notes')
  async generateReleaseNotes(@Body() body: { taskId: string }) {
    return this.releaseService.generateReleaseNotes(body.taskId);
  }

  @Get('task/:taskId/gate')
  async getReleaseGate(@Param('taskId') taskId: string) {
    return this.releaseService.evaluateGate(taskId);
  }

  @Get('task/:taskId/plan')
  async getReleasePlan(@Param('taskId') taskId: string) {
    return this.releaseService.generateReleasePlan(taskId);
  }
}
