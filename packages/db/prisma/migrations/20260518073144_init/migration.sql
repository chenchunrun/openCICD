-- CreateEnum
CREATE TYPE "TaskSourceType" AS ENUM ('github_issue', 'github_pr_comment', 'ci_failure', 'manual', 'incident');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('low', 'medium', 'high', 'critical');

-- CreateEnum
CREATE TYPE "FilesystemMode" AS ENUM ('read_only', 'workspace_write', 'full_access');

-- CreateEnum
CREATE TYPE "NetworkMode" AS ENUM ('disabled', 'allowlist', 'unrestricted');

-- CreateEnum
CREATE TYPE "SecretsMode" AS ENUM ('none', 'setup_only', 'task_scoped');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('queued', 'policy_blocked', 'preparing', 'running', 'waiting_approval', 'verifying', 'reviewing', 'repairing', 'completed', 'failed', 'cancelled', 'stopped');

-- CreateEnum
CREATE TYPE "ReviewVerdict" AS ENUM ('approved', 'requires_changes', 'requires_human_review', 'blocked');

-- CreateEnum
CREATE TYPE "EvidenceStatus" AS ENUM ('draft', 'complete', 'archived');

-- CreateEnum
CREATE TYPE "ApprovalAction" AS ENUM ('approved', 'rejected');

-- CreateTable
CREATE TABLE "repositories" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'github',
    "owner" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "defaultBranch" TEXT NOT NULL DEFAULT 'main',
    "languages" TEXT[],
    "packageManager" TEXT,
    "testCommand" TEXT,
    "lintCommand" TEXT,
    "typecheckCommand" TEXT,
    "buildCommand" TEXT,
    "codeownersPath" TEXT,
    "highRiskPaths" TEXT[],
    "hasAgentsMd" BOOLEAN NOT NULL DEFAULT false,
    "hasClaudeMd" BOOLEAN NOT NULL DEFAULT false,
    "hasAiCicdDir" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repositories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repo_scan_results" (
    "id" TEXT NOT NULL,
    "repo_id" TEXT NOT NULL,
    "scanType" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repo_scan_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repo_policies" (
    "id" TEXT NOT NULL,
    "repo_id" TEXT NOT NULL,
    "layer" TEXT NOT NULL,
    "path" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "policy" JSONB NOT NULL,
    "sourceFile" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repo_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_tasks" (
    "id" TEXT NOT NULL,
    "repo_id" TEXT NOT NULL,
    "source_type" "TaskSourceType" NOT NULL,
    "source_url" TEXT,
    "source_payload" JSONB,
    "goal" TEXT NOT NULL,
    "scope" JSONB NOT NULL,
    "constraints" TEXT[],
    "done_when" TEXT[],
    "risk_level" "RiskLevel" NOT NULL,
    "risk_reasons" TEXT[],
    "filesystem_mode" "FilesystemMode" NOT NULL DEFAULT 'workspace_write',
    "allowed_paths" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "forbidden_paths" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowed_commands" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "denied_commands" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "network_mode" "NetworkMode" NOT NULL DEFAULT 'disabled',
    "network_domains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "secrets_mode" "SecretsMode" NOT NULL DEFAULT 'none',
    "max_repair_loops" INTEGER NOT NULL DEFAULT 2,
    "allow_test_update" BOOLEAN NOT NULL DEFAULT true,
    "forbid_test_deletion" BOOLEAN NOT NULL DEFAULT true,
    "forbid_policy_weakening" BOOLEAN NOT NULL DEFAULT true,
    "auto_approve" BOOLEAN NOT NULL DEFAULT false,
    "requires_human_approval" BOOLEAN NOT NULL DEFAULT false,
    "human_approval_paths" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "preferred_agent" TEXT,
    "fallback_agent" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_by" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_approvals" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "action" "ApprovalAction" NOT NULL,
    "approver" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_runs" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "agent_name" TEXT NOT NULL,
    "execution_mode" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'queued',
    "branch" TEXT,
    "commit_sha" TEXT,
    "pull_request_url" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "files_changed" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "commands_run" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "network_used" BOOLEAN NOT NULL DEFAULT false,
    "secrets_accessed" BOOLEAN NOT NULL DEFAULT false,
    "diff_summary" JSONB,
    "diff_full" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_events" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repair_loops" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "loop_number" INTEGER NOT NULL,
    "failure_type" TEXT NOT NULL,
    "ci_job" TEXT,
    "log_excerpt_ref" TEXT,
    "hypothesis" TEXT,
    "files_changed" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tests_added" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "verification_result" TEXT,
    "escalation_reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repair_loops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_results" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "agent_name" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "findings" JSONB NOT NULL DEFAULT '[]',
    "verdict" "ReviewVerdict" NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidences" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "run_id" TEXT,
    "schema_version" TEXT NOT NULL DEFAULT '1.0',
    "status" "EvidenceStatus" NOT NULL DEFAULT 'draft',
    "repo" TEXT NOT NULL,
    "source_sha" TEXT,
    "target_branch" TEXT,
    "agent_section" JSONB,
    "policy_section" JSONB,
    "context_section" JSONB,
    "execution_section" JSONB,
    "verification_section" JSONB,
    "review_section" JSONB,
    "repair_section" JSONB,
    "residual_risk_section" JSONB,
    "full_evidence" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "evidences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "repositories_fullName_key" ON "repositories"("fullName");

-- CreateIndex
CREATE INDEX "repositories_fullName_idx" ON "repositories"("fullName");

-- CreateIndex
CREATE INDEX "repo_scan_results_repo_id_idx" ON "repo_scan_results"("repo_id");

-- CreateIndex
CREATE INDEX "repo_policies_repo_id_layer_idx" ON "repo_policies"("repo_id", "layer");

-- CreateIndex
CREATE UNIQUE INDEX "repo_policies_repo_id_layer_path_key" ON "repo_policies"("repo_id", "layer", "path");

-- CreateIndex
CREATE INDEX "agent_tasks_repo_id_status_idx" ON "agent_tasks"("repo_id", "status");

-- CreateIndex
CREATE INDEX "agent_tasks_status_idx" ON "agent_tasks"("status");

-- CreateIndex
CREATE INDEX "task_approvals_task_id_idx" ON "task_approvals"("task_id");

-- CreateIndex
CREATE INDEX "agent_runs_task_id_idx" ON "agent_runs"("task_id");

-- CreateIndex
CREATE INDEX "agent_runs_status_idx" ON "agent_runs"("status");

-- CreateIndex
CREATE INDEX "agent_runs_agent_name_idx" ON "agent_runs"("agent_name");

-- CreateIndex
CREATE INDEX "agent_events_run_id_timestamp_idx" ON "agent_events"("run_id", "timestamp");

-- CreateIndex
CREATE INDEX "repair_loops_run_id_idx" ON "repair_loops"("run_id");

-- CreateIndex
CREATE INDEX "review_results_run_id_idx" ON "review_results"("run_id");

-- CreateIndex
CREATE INDEX "evidences_task_id_idx" ON "evidences"("task_id");

-- CreateIndex
CREATE INDEX "evidences_run_id_idx" ON "evidences"("run_id");

-- AddForeignKey
ALTER TABLE "repo_scan_results" ADD CONSTRAINT "repo_scan_results_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repo_policies" ADD CONSTRAINT "repo_policies_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "repositories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_approvals" ADD CONSTRAINT "task_approvals_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "agent_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "agent_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_loops" ADD CONSTRAINT "repair_loops_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_results" ADD CONSTRAINT "review_results_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidences" ADD CONSTRAINT "evidences_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "agent_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
