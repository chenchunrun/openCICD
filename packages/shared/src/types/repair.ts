import type { FailureClassification } from './enums.js';

export interface RepairLoop {
  id: string;
  runId: string;
  loopNumber: number;
  failureType: FailureClassification;
  ciJob?: string;
  logExcerptRef?: string;
  hypothesis?: string;
  filesChanged: string[];
  testsAdded: string[];
  verificationResult?: 'passed' | 'failed' | 'skipped';
  escalationReason?: string;
  createdAt: string;
}

export interface RepairEligibility {
  eligible: boolean;
  reason?: string;
}

export interface RepairResult {
  loopNumber: number;
  success: boolean;
  filesChanged: string[];
  testsAdded: string[];
  verificationResult: 'passed' | 'failed' | 'skipped';
}
