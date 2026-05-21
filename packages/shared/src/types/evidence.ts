import type { EvidenceStatus, RiskLevel } from './enums.js';
import type { EffectivePolicy } from './policy.js';

export interface Evidence {
  id: string;
  taskId: string;
  runId?: string;
  schemaVersion: string;
  status: EvidenceStatus;
  repo: string;
  sourceSha?: string;
  targetBranch?: string;
  agentSection?: AgentEvidenceSection;
  policySection?: PolicyEvidenceSection;
  contextSection?: ContextEvidenceSection;
  executionSection?: ExecutionEvidenceSection;
  verificationSection?: VerificationEvidenceSection;
  reviewSection?: ReviewEvidenceSection;
  repairSection?: RepairEvidenceSection;
  residualRiskSection?: ResidualRiskSection;
  createdAt: string;
  updatedAt: string;
}

export interface AgentEvidenceSection {
  name: string;
  executionMode: string;
  model?: string;
  adapterVersion: string;
}

export interface PolicyEvidenceSection {
  riskLevel: RiskLevel;
  policy: EffectivePolicy;
}

export interface ContextEvidenceSection {
  trustedSources: string[];
  untrustedSources: string[];
}

export interface ExecutionEvidenceSection {
  commandsRun: string[];
  filesChanged: string[];
  networkUsed: boolean;
  secretsAccessed: boolean;
}

export interface VerificationEvidenceSection {
  [checkName: string]: 'passed' | 'failed' | 'skipped';
}

export interface ReviewEvidenceSection {
  aiReview: 'completed' | 'pending' | 'skipped';
  humanReview: 'required' | 'completed' | 'waived';
  codeOwnerApproval: 'pending' | 'approved' | 'rejected';
}

export interface RepairEvidenceSection {
  loops: number;
  finalStatus: 'passed' | 'failed' | 'not_needed';
}

export interface ResidualRiskSection {
  accepted: boolean;
  notes: string[];
}

export interface EvidenceExportOptions {
  taskIds?: string[];
  runIds?: string[];
  format?: 'json' | 'summary';
  startDate?: string;
  endDate?: string;
}
