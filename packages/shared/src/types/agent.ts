import type { AgentMode, AgentExecutionMode } from './enums.js';
import type { FilesystemMode } from './enums.js';
import type { NetworkMode } from './enums.js';

export interface AgentCapabilities {
  readFiles: boolean;
  editFiles: boolean;
  runCommands: boolean;
  createPr: boolean;
  useMcp: boolean;
  network: boolean;
  hooks?: boolean;
}

export interface AgentConfig {
  name: string;
  modes: AgentMode[];
  execution: AgentExecutionMode[];
  capabilities: AgentCapabilities;
}

export interface AgentRunPlan {
  runId?: string;
  taskId: string;
  agentName: string;
  branch: string;
  sandboxDir: string;
  workingDirectory: string;
  filesystemMode: FilesystemMode;
  networkMode: NetworkMode;
  networkDomains: string[];
  command: string;
  args: string[];
  env: Record<string, string>;
  timeoutMs: number;
  idleTimeoutMs?: number;
}

export interface AgentTaskContext {
  taskId: string;
  goal: string;
  allowedPaths: string[];
  forbiddenPaths: string[];
  doneWhen: string[];
  constraints: string[];
  repoFullName?: string | null;
  repoLocalPath?: string | null;
}

export interface GitDiff {
  files: DiffFile[];
  summary: {
    additions: number;
    deletions: number;
    changedFiles: number;
  };
}

export interface DiffFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
  patch: string;
}

export interface AgentEvidence {
  taskId: string;
  runId: string;
  commandsRun: string[];
  filesChanged: string[];
  networkUsed: boolean;
  secretsAccessed: boolean;
  succeeded: boolean;
  exitCode: number | null;
  timedOut: boolean;
  stoppedByUser: boolean;
}
