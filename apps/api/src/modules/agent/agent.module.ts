import { Module } from '@nestjs/common';
import { ConfigModule } from '../../config/config.module.js';
import { AgentController } from './agent.controller.js';
import { AgentRegistryService } from './agent-registry.service.js';
import { AgentService } from './agent.service.js';
import { ClaudeCodeAdapter } from './adapters/claude-code.adapter.js';
import { CodexAdapter } from './adapters/codex.adapter.js';
import { CliAgentRuntimeService } from './cli-agent-runtime.service.js';

@Module({
  imports: [ConfigModule],
  controllers: [AgentController],
  providers: [AgentRegistryService, AgentService, CliAgentRuntimeService, ClaudeCodeAdapter, CodexAdapter],
  exports: [AgentRegistryService, AgentService],
})
export class AgentModule {}
