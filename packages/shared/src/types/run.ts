import type { RunStatus, AgentExecutionMode } from './enums.js';

export interface AgentEvent {
  id: string;
  runId: string;
  type: 'stdout' | 'stderr' | 'tool_use' | 'tool_result' | 'error' | 'status';
  data: Record<string, unknown>;
  timestamp: string;
}

export interface AgentRun {
  id: string;
  taskId: string;
  agentName: string;
  executionMode: AgentExecutionMode;
  status: RunStatus;
  branch?: string;
  commitSha?: string;
  pullRequestUrl?: string;
  startedAt?: string;
  finishedAt?: string;
  filesChanged: string[];
  commandsRun: string[];
  networkUsed: boolean;
  secretsAccessed: boolean;
  diffSummary?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRunInput {
  taskId: string;
  agentName?: string;
}

export interface RunResponse {
  id: string;
  taskId: string;
  agentName: string;
  status: RunStatus;
  branch?: string;
  pullRequestUrl?: string;
  filesChanged: string[];
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
}
