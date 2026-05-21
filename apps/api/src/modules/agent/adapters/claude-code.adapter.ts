import { Injectable } from '@nestjs/common';
import { ConfigService } from '../../../config/configuration.js';
import type { AgentConfig, AgentEvidence, AgentRunPlan, AgentTaskContext, EffectivePolicy, GitDiff } from '@aicp/shared';
import { CliAgentRuntimeService } from '../cli-agent-runtime.service.js';

@Injectable()
export class ClaudeCodeAdapter {
  constructor(
    private readonly config: ConfigService,
    private readonly runtime: CliAgentRuntimeService,
  ) {}

  getConfig(): AgentConfig {
    return {
      name: 'claude_code',
      modes: ['generate_pr', 'review_pr', 'repair_ci', 'triage_issue'],
      execution: ['cli', 'github_action'],
      capabilities: {
        readFiles: true,
        editFiles: true,
        runCommands: true,
        createPr: true,
        useMcp: true,
        network: true,
        hooks: true,
      },
    };
  }

  async prepare(task: AgentTaskContext, policy: EffectivePolicy): Promise<AgentRunPlan> {
    const branch = `ai/task-${task.taskId.substring(0, 8)}`;
    const sandboxDir = `/tmp/aicp/runs/${task.taskId}`;

    return {
      taskId: task.taskId,
      agentName: 'claude_code',
      branch,
      sandboxDir,
      workingDirectory: task.repoLocalPath || this.config.workspaceDir,
      filesystemMode: policy.filesystem,
      networkMode: policy.network.mode,
      networkDomains: policy.network.domains,
      command: this.config.claudeCodePath,
      args: [
        '--print',
        '--bare',
        '--verbose',
        '--permission-mode', 'bypassPermissions',
        '--output-format', 'stream-json',
        this.buildExecutionPrompt(task, policy),
      ],
      env: {
        ...this.buildPolicyEnv(policy),
        AICP_TASK_ID: task.taskId,
        AICP_BRANCH: branch,
      },
      timeoutMs: 600_000,
      idleTimeoutMs: 120_000,
    };
  }

  async run(plan: AgentRunPlan): Promise<AsyncIterable<{ type: string; data: Record<string, unknown> }>> {
    return this.runtime.execute(plan, 'Agent execution started');
  }

  async stop(runId: string): Promise<void> {
    await this.runtime.stop(runId);
  }

  async collectDiff(runId: string): Promise<GitDiff> {
    return this.runtime.collectDiff(runId);
  }

  async collectEvidence(runId: string): Promise<AgentEvidence> {
    return this.runtime.collectEvidence(runId);
  }

  async cleanup(runId: string): Promise<void> {
    await this.runtime.cleanup(runId);
  }

  private buildPolicyEnv(policy: EffectivePolicy): Record<string, string> {
    const env: Record<string, string> = {};
    env.AICP_FILESYSTEM_MODE = policy.filesystem;
    env.AICP_NETWORK_MODE = policy.network.mode;
    env.AICP_NETWORK_ALLOWED_DOMAINS = policy.network.domains.join(',');
    env.AICP_SECRETS_MODE = policy.secrets.mode;
    return env;
  }

  private buildExecutionPrompt(task: AgentTaskContext, policy: EffectivePolicy): string {
    const sections = [
      'Execute the following task in the current repository sandbox.',
      `Task ID: ${task.taskId}`,
      task.repoFullName ? `Repository: ${task.repoFullName}` : '',
      `Goal: ${task.goal}`,
      task.allowedPaths.length > 0 ? `Allowed paths:\n- ${task.allowedPaths.join('\n- ')}` : '',
      task.forbiddenPaths.length > 0 ? `Forbidden paths:\n- ${task.forbiddenPaths.join('\n- ')}` : '',
      task.doneWhen.length > 0 ? `Done when:\n- ${task.doneWhen.join('\n- ')}` : '',
      task.constraints.length > 0 ? `Constraints:\n- ${task.constraints.join('\n- ')}` : '',
      `Filesystem mode: ${policy.filesystem}`,
      `Network mode: ${policy.network.mode}`,
      policy.network.domains.length > 0
        ? `Allowed network domains:\n- ${policy.network.domains.join('\n- ')}`
        : 'Allowed network domains: none',
      `Secrets mode: ${policy.secrets.mode}`,
      policy.network.mode === 'disabled'
        ? 'Network access is disabled. Do not fetch packages, call external APIs, or use curl/wget.'
        : 'Use network only when strictly necessary and only within the allowed domain list.',
      'Git metadata may be unavailable in some sandboxes. If git commands fail, continue by inspecting files directly and do not treat missing git history or status as a task failure.',
      'Stay within the declared scope. Prefer the smallest possible change set. If no code change is required, say so explicitly.',
    ];

    return sections.filter(Boolean).join('\n\n');
  }
}
