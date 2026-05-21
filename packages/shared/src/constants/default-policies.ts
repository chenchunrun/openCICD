import type { FilesystemMode, NetworkMode, SecretsMode } from '../types/enums.js';

export interface DefaultPolicy {
  filesystem: FilesystemMode;
  network: NetworkMode;
  secrets: SecretsMode;
  mcp: 'none';
  maxRepairLoops: number;
}

export const DEFAULT_POLICY: DefaultPolicy = {
  filesystem: 'workspace_write',
  network: 'disabled',
  secrets: 'none',
  mcp: 'none',
  maxRepairLoops: 2,
};

export const FORBIDDEN_AGENT_ACTIONS: readonly string[] = [
  'direct_production_deploy',
  'read_production_secrets',
  'delete_tests_to_pass_ci',
  'weaken_security_policy',
  'modify_ci_to_skip_checks',
  'access_prod_database',
  'force_push_main',
  'approve_own_pr',
] as const;

export const REQUIRED_FOR_HIGH_RISK: readonly string[] = [
  'code_owner_approval',
  'security_review',
  'full_evidence',
  'agent_policy_tests',
] as const;
