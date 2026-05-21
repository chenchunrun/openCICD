import type {
  FilesystemMode,
  NetworkMode,
  SecretsMode,
  RiskLevel,
  TaskSourceType,
} from './enums.js';

export interface TaskScope {
  allowedPaths: string[];
  forbiddenPaths: string[];
}

export interface TaskSource {
  type: TaskSourceType;
  url?: string;
  payload?: Record<string, unknown>;
}

export interface TaskRisk {
  level: RiskLevel;
  reasons: string[];
}

export interface TaskPermissions {
  filesystemMode: FilesystemMode;
  allowedPaths: string[];
  forbiddenPaths: string[];
  allowedCommands: string[];
  deniedCommands: string[];
  networkMode: NetworkMode;
  networkDomains: string[];
  secretsMode: SecretsMode;
}

export interface RepairPolicyConfig {
  maxRepairLoops: number;
  allowTestUpdate: boolean;
  forbidTestDeletion: boolean;
  forbidPolicyWeakening: boolean;
}

export interface ApprovalPolicyConfig {
  autoApprove: boolean;
  requiresHumanApproval: boolean;
  humanApprovalPaths: string[];
}

export interface AgentTask {
  id: string;
  repoId: string;
  source: TaskSource;
  goal: string;
  scope: TaskScope;
  constraints: string[];
  doneWhen: string[];
  risk: TaskRisk;
  permissions: TaskPermissions;
  repairPolicy: RepairPolicyConfig;
  approvalPolicy: ApprovalPolicyConfig;
  preferredAgent?: string;
  fallbackAgent?: string;
  status: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskInput {
  source: TaskSource;
  goal: string;
  scope: TaskScope;
  constraints?: string[];
  doneWhen: string[];
  preferredAgent?: string;
  fallbackAgent?: string;
}

export interface TaskResponse {
  id: string;
  repoId: string;
  source: TaskSource;
  goal: string;
  scope: TaskScope;
  constraints: string[];
  doneWhen: string[];
  risk: TaskRisk;
  status: string;
  createdAt: string;
}
