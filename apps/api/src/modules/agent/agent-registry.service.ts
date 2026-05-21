import { Injectable } from '@nestjs/common';
import type { AgentConfig } from '@aicp/shared';
import { ClaudeCodeAdapter } from './adapters/claude-code.adapter.js';
import { CodexAdapter } from './adapters/codex.adapter.js';

@Injectable()
export class AgentRegistryService {
  private readonly agents: Map<string, { config: AgentConfig; adapter: ClaudeCodeAdapter | CodexAdapter }> = new Map();

  constructor(
    claudeCodeAdapter: ClaudeCodeAdapter,
    codexAdapter: CodexAdapter,
  ) {
    this.register(claudeCodeAdapter.getConfig(), claudeCodeAdapter);
    this.register(codexAdapter.getConfig(), codexAdapter);
  }

  register(config: AgentConfig, adapter: ClaudeCodeAdapter | CodexAdapter): void {
    this.agents.set(config.name, { config, adapter });
  }

  get(name: string): { config: AgentConfig; adapter: ClaudeCodeAdapter | CodexAdapter } | undefined {
    return this.agents.get(name);
  }

  getAdapter(name: string): ClaudeCodeAdapter | CodexAdapter | undefined {
    return this.agents.get(name)?.adapter;
  }

  listAgents(): Array<{ name: string; config: AgentConfig }> {
    return [...this.agents.entries()].map(([name, { config }]) => ({ name, config }));
  }

  getAlternativeAgent(excludeName: string): { config: AgentConfig; adapter: ClaudeCodeAdapter | CodexAdapter } | undefined {
    for (const [name, entry] of this.agents) {
      if (name !== excludeName) return entry;
    }
    return undefined;
  }
}
