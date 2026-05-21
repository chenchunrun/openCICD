export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type FilesystemMode = 'read_only' | 'workspace_write' | 'full_access';

export type NetworkMode = 'disabled' | 'allowlist' | 'unrestricted';

export type SecretsMode = 'none' | 'setup_only' | 'task_scoped';

export type RunStatus =
  | 'queued'
  | 'policy_blocked'
  | 'preparing'
  | 'running'
  | 'waiting_approval'
  | 'verifying'
  | 'reviewing'
  | 'repairing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'stopped';

export type ReviewVerdict = 'approved' | 'requires_changes' | 'requires_human_review' | 'blocked';

export type EvidenceStatus = 'draft' | 'complete' | 'archived';

export type ApprovalAction = 'approved' | 'rejected';

export type TaskSourceType =
  | 'github_issue'
  | 'github_pr_comment'
  | 'ci_failure'
  | 'manual'
  | 'incident';

export type FailureClassification =
  | 'lint_failure'
  | 'formatting_failure'
  | 'type_error'
  | 'unit_test_failure'
  | 'integration_failure'
  | 'e2e_failure'
  | 'flaky_test'
  | 'dependency_install_failure'
  | 'migration_failure'
  | 'security_scan_failure'
  | 'policy_violation'
  | 'infrastructure_plan_failure';

export type AgentMode =
  | 'generate_pr'
  | 'review_pr'
  | 'repair_ci'
  | 'triage_issue'
  | 'summarize'
  | 'release_assist'
  | 'policy_review';

export type AgentExecutionMode = 'cli' | 'github_action' | 'cloud';
