import type {
  FilesystemMode,
  NetworkMode,
  SecretsMode,
  RiskLevel,
} from './enums.js';

export interface NetworkPolicy {
  mode: NetworkMode;
  domains: string[];
  methods: string[];
}

export interface SecretsPolicy {
  mode: SecretsMode;
  refs: string[];
}

export interface McpPolicy {
  allowedServers: string[];
  deniedServers: string[];
}

export interface EffectivePolicy {
  filesystem: FilesystemMode;
  allowedPaths: string[];
  forbiddenPaths: string[];
  allowedCommands: string[];
  deniedCommands: string[];
  network: NetworkPolicy;
  secrets: SecretsPolicy;
  mcp: McpPolicy;
}

export interface PolicyLayer {
  id: string;
  repoId: string;
  layer: 'org' | 'repo' | 'directory' | 'task' | 'emergency';
  path?: string;
  priority: number;
  policy: EffectivePolicy;
  sourceFile?: string;
  active: boolean;
}

export interface EffectivePolicyQuery {
  repoId: string;
  path?: string;
  taskOverrides?: Partial<EffectivePolicy>;
}

export interface PolicyValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface PolicyFileChange {
  changed: boolean;
  files: string[];
  riskLevel: RiskLevel;
}
