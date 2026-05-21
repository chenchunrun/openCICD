import { Injectable } from '@nestjs/common';
import { AgentRegistryService } from './agent-registry.service.js';
import type { AgentEvidence, AgentRunPlan, AgentTaskContext, EffectivePolicy, GitDiff } from '@aicp/shared';

@Injectable()
export class AgentService {
  constructor(private readonly registry: AgentRegistryService) {}

  async prepareRun(agentName: string, task: AgentTaskContext, policy: EffectivePolicy): Promise<AgentRunPlan> {
    const entry = this.registry.getAdapter(agentName);
    if (!entry) throw new Error(`Agent not found: ${agentName}`);
    return entry.prepare(task, policy);
  }

  async run(
    agentName: string,
    plan: AgentRunPlan,
  ): Promise<AsyncIterable<{ type: string; data: Record<string, unknown> }>> {
    const entry = this.registry.getAdapter(agentName);
    if (!entry) throw new Error(`Agent not found: ${agentName}`);
    return entry.run(plan);
  }

  async collectDiff(agentName: string, runId: string): Promise<GitDiff> {
    const entry = this.registry.getAdapter(agentName);
    if (!entry) throw new Error(`Agent not found: ${agentName}`);
    return entry.collectDiff(runId);
  }

  async stop(agentName: string, runId: string): Promise<void> {
    const entry = this.registry.getAdapter(agentName);
    if (!entry) throw new Error(`Agent not found: ${agentName}`);
    await entry.stop(runId);
  }

  async cleanup(agentName: string, runId: string): Promise<void> {
    const entry = this.registry.getAdapter(agentName);
    if (!entry) throw new Error(`Agent not found: ${agentName}`);
    await entry.cleanup(runId);
  }

  async collectEvidence(agentName: string, runId: string): Promise<AgentEvidence> {
    const entry = this.registry.getAdapter(agentName);
    if (!entry) throw new Error(`Agent not found: ${agentName}`);
    return entry.collectEvidence(runId);
  }
}
