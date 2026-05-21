import type { ReviewVerdict } from './enums.js';

export type ReviewCategory =
  | 'security'
  | 'logic_correctness'
  | 'test_quality'
  | 'architecture_consistency'
  | 'api_compatibility'
  | 'performance_risk'
  | 'data_migration'
  | 'observability'
  | 'rollback_feasibility';

export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface ReviewFinding {
  severity: FindingSeverity;
  category: ReviewCategory;
  file: string;
  line?: number;
  message: string;
  recommendation: string;
}

export interface ReviewResult {
  id: string;
  runId: string;
  agentName: string;
  summary: string;
  findings: ReviewFinding[];
  verdict: ReviewVerdict;
  reviewedAt: string;
}

export interface ReviewGateResult {
  canMerge: boolean;
  blockers: string[];
  warnings: string[];
}
