import { Controller, Get } from '@nestjs/common';
import { AgentRegistryService } from './agent-registry.service.js';

@Controller('agents')
export class AgentController {
  constructor(private readonly registry: AgentRegistryService) {}

  @Get()
  async listAgents() {
    return this.registry.listAgents();
  }
}
