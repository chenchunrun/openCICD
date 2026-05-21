import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module.js';
import { RunnerController } from './runner.controller.js';
import { RunnerService } from './runner.service.js';

@Module({
  imports: [AgentModule],
  controllers: [RunnerController],
  providers: [RunnerService],
  exports: [RunnerService],
})
export class RunnerModule {}
