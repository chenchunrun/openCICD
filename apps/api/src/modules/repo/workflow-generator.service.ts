import { Injectable } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stringify as yamlStringify } from 'yaml';

export interface WorkflowDefinition {
  filename: string;
  displayName: string;
  purpose: string;
  installPath: string;
  triggers: string[];
  requiredSecrets: string[];
  content: string;
}

export interface WorkflowInstallationState {
  status: 'installed' | 'missing' | 'drifted' | 'unknown';
  detail: string;
}

export interface WorkflowSecretRequirement {
  name: string;
  status: 'required_but_unverified';
  detail: string;
}

export interface RepoWorkflowDefinition extends WorkflowDefinition {
  installation: WorkflowInstallationState;
  secrets: WorkflowSecretRequirement[];
}

@Injectable()
export class WorkflowGeneratorService {
  private readonly apiUrlSecret = 'AICP_API_URL';
  private readonly checkoutStep = { uses: 'actions/checkout@v4' };
  private readonly setupCurlStep = {
    name: 'Prepare API access',
    run: `test -n "\${{ secrets.${this.apiUrlSecret} }}"`,
  };

  generateIntentGateWorkflow(): string {
    return yamlStringify({
      name: 'AI Intent Gate',
      on: {
        issues: { types: ['opened', 'edited'] },
        issue_comment: { types: ['created'] },
      },
      jobs: {
        'intent-gate': {
          'runs-on': 'ubuntu-latest',
          steps: [
            this.checkoutStep,
            this.setupCurlStep,
            {
              name: 'Forward GitHub event to AICP',
              run: 'curl -X POST ${{ secrets.AICP_API_URL }}/webhooks/github -H "Content-Type: application/json" -d "$(cat $GITHUB_EVENT_PATH)"',
            },
          ],
        },
      },
    });
  }

  generateAgentRunWorkflow(): string {
    return yamlStringify({
      name: 'AI Agent Run',
      on: {
        workflow_dispatch: {
          inputs: {
            task_id: { required: true, type: 'string' },
          },
        },
      },
      jobs: {
        'agent-run': {
          'runs-on': 'ubuntu-latest',
          steps: [
            this.checkoutStep,
            this.setupCurlStep,
            {
              name: 'Schedule orchestrated agent run',
              run: 'curl -X POST ${{ secrets.AICP_API_URL }}/api/orchestrator/tasks/${{ inputs.task_id }}/execute -H "Content-Type: application/json" -d "{}"',
            },
          ],
        },
      },
    });
  }

  generateReviewWorkflow(): string {
    return yamlStringify({
      name: 'AI Review Export',
      on: {
        workflow_dispatch: {
          inputs: {
            run_id: { required: true, type: 'string' },
          },
        },
      },
      jobs: {
        'review-export': {
          'runs-on': 'ubuntu-latest',
          steps: [
            this.setupCurlStep,
            {
              name: 'Fetch GitHub review payload',
              run: 'curl -fsS ${{ secrets.AICP_API_URL }}/api/reviews/run/${{ inputs.run_id }}/github/review -o ai-review.json',
            },
            {
              uses: 'actions/upload-artifact@v4',
              with: {
                name: 'ai-review-payload',
                path: 'ai-review.json',
              },
            },
          ],
        },
      },
    });
  }

  generateRepairWorkflow(): string {
    return yamlStringify({
      name: 'AI Repair Trigger',
      on: {
        workflow_run: {
          workflows: ['CI'],
          types: ['completed'],
        },
      },
      jobs: {
        'repair-trigger': {
          if: "${{ github.event.workflow_run.conclusion == 'failure' }}",
          'runs-on': 'ubuntu-latest',
          steps: [
            this.setupCurlStep,
            {
              name: 'Forward failed workflow event to AICP',
              run: 'curl -X POST ${{ secrets.AICP_API_URL }}/webhooks/github -H "Content-Type: application/json" -d "$(cat $GITHUB_EVENT_PATH)"',
            },
          ],
        },
      },
    });
  }

  generatePolicyTestWorkflow(): string {
    return yamlStringify({
      name: 'AI Policy Test',
      on: {
        pull_request: {
          paths: [
            'AGENTS.md',
            'CLAUDE.md',
            '.ai-cicd/**',
            '.mcp.json',
            '.codex/**',
            '.claude/**',
          ],
        },
      },
      jobs: {
        'policy-test': {
          'runs-on': 'ubuntu-latest',
          steps: [
            this.checkoutStep,
            this.setupCurlStep,
            {
              name: 'Validate policy configuration',
              run: "curl -X POST ${{ secrets.AICP_API_URL }}/api/policies/validate -H 'Content-Type: application/json' -d '{\"policy\": {\"source\": \"pull_request\"}}'",
            },
          ],
        },
      },
    });
  }

  generateEvidenceWorkflow(): string {
    return yamlStringify({
      name: 'AI Evidence Export',
      on: {
        workflow_dispatch: {
          inputs: {
            run_id: { required: true, type: 'string' },
          },
        },
      },
      jobs: {
        'evidence-export': {
          'runs-on': 'ubuntu-latest',
          steps: [
            this.setupCurlStep,
            {
              name: 'Fetch evidence bundle',
              run: 'curl -fsS ${{ secrets.AICP_API_URL }}/api/evidence/run/${{ inputs.run_id }} -o ai-evidence.json',
            },
            {
              uses: 'actions/upload-artifact@v4',
              with: {
                name: 'ai-evidence',
                path: 'ai-evidence.json',
              },
            },
          ],
        },
      },
    });
  }

  generateReleaseWorkflow(): string {
    return yamlStringify({
      name: 'AI Release Gate',
      on: {
        workflow_dispatch: {
          inputs: {
            task_id: { required: true, type: 'string' },
          },
        },
      },
      jobs: {
        'release-gate': {
          'runs-on': 'ubuntu-latest',
          steps: [
            this.setupCurlStep,
            {
              name: 'Fetch release gate',
              run: 'curl -fsS ${{ secrets.AICP_API_URL }}/api/release/task/${{ inputs.task_id }}/gate -o release-gate.json',
            },
            {
              name: 'Fetch release plan',
              run: 'curl -fsS ${{ secrets.AICP_API_URL }}/api/release/task/${{ inputs.task_id }}/plan -o release-plan.json',
            },
            {
              uses: 'actions/upload-artifact@v4',
              with: {
                name: 'ai-release-package',
                path: 'release-gate.json\nrelease-plan.json',
              },
            },
          ],
        },
      },
    });
  }

  generateWorkflowDefinitions(): WorkflowDefinition[] {
    return [
      {
        filename: 'ai-intent-gate.yml',
        displayName: 'Intent Gate',
        purpose:
          'Normalizes incoming GitHub issues and comments before the control plane schedules agent work.',
        installPath: '.github/workflows/ai-intent-gate.yml',
        triggers: ['Issue opened or edited', 'Issue comment created'],
        requiredSecrets: [this.apiUrlSecret],
        content: this.generateIntentGateWorkflow(),
      },
      {
        filename: 'ai-agent-run.yml',
        displayName: 'Agent Run',
        purpose:
          'Lets operators dispatch a normalized task from GitHub into the orchestrated runner path.',
        installPath: '.github/workflows/ai-agent-run.yml',
        triggers: ['Manual workflow_dispatch with task_id'],
        requiredSecrets: [this.apiUrlSecret],
        content: this.generateAgentRunWorkflow(),
      },
      {
        filename: 'ai-review.yml',
        displayName: 'Review Export',
        purpose:
          'Exports the GitHub review payload for a completed run so human reviewers can inspect the generated review package.',
        installPath: '.github/workflows/ai-review.yml',
        triggers: ['Manual workflow_dispatch with run_id'],
        requiredSecrets: [this.apiUrlSecret],
        content: this.generateReviewWorkflow(),
      },
      {
        filename: 'ai-repair.yml',
        displayName: 'Repair Trigger',
        purpose:
          'Relays failed CI workflow runs back into the control plane so the repair loop can decide whether to attempt self-repair.',
        installPath: '.github/workflows/ai-repair.yml',
        triggers: ['CI workflow_run completed with failure'],
        requiredSecrets: [this.apiUrlSecret],
        content: this.generateRepairWorkflow(),
      },
      {
        filename: 'ai-policy-test.yml',
        displayName: 'Policy Test',
        purpose:
          'Revalidates policy-sensitive configuration changes before they are merged into the repository.',
        installPath: '.github/workflows/ai-policy-test.yml',
        triggers: ['Pull request touching policy-sensitive files'],
        requiredSecrets: [this.apiUrlSecret],
        content: this.generatePolicyTestWorkflow(),
      },
      {
        filename: 'ai-evidence.yml',
        displayName: 'Evidence Export',
        purpose:
          'Pulls the evidence bundle for a run and stores it as a GitHub artifact for audit and downstream review.',
        installPath: '.github/workflows/ai-evidence.yml',
        triggers: ['Manual workflow_dispatch with run_id'],
        requiredSecrets: [this.apiUrlSecret],
        content: this.generateEvidenceWorkflow(),
      },
      {
        filename: 'ai-release.yml',
        displayName: 'Release Gate',
        purpose:
          'Fetches release gate and release plan artifacts so release readiness can be checked before any downstream promotion step.',
        installPath: '.github/workflows/ai-release.yml',
        triggers: ['Manual workflow_dispatch with task_id'],
        requiredSecrets: [this.apiUrlSecret],
        content: this.generateReleaseWorkflow(),
      },
    ];
  }

  async inspectWorkflowDefinitions(localPath?: string | null): Promise<RepoWorkflowDefinition[]> {
    const definitions = this.generateWorkflowDefinitions();

    return Promise.all(
      definitions.map(async (definition) => ({
        ...definition,
        installation: await this.inspectWorkflowInstallation(definition, localPath),
        secrets: definition.requiredSecrets.map((name) => ({
          name,
          status: 'required_but_unverified' as const,
          detail:
            'GitHub repository secrets cannot be verified from the local checkout. Confirm this secret exists in GitHub before dispatch.',
        })),
      })),
    );
  }

  generateAllWorkflows(): Record<string, string> {
    return Object.fromEntries(
      this.generateWorkflowDefinitions().map((workflow) => [
        workflow.filename,
        workflow.content,
      ]),
    );
  }

  private async inspectWorkflowInstallation(
    definition: WorkflowDefinition,
    localPath?: string | null,
  ): Promise<WorkflowInstallationState> {
    if (!localPath) {
      return {
        status: 'unknown',
        detail: 'No local checkout is connected, so workflow installation cannot be verified.',
      };
    }

    try {
      const localContent = await readFile(join(localPath, definition.installPath), 'utf8');
      const matches = this.normalizeWorkflowContent(localContent) === this.normalizeWorkflowContent(definition.content);
      return matches
        ? {
            status: 'installed',
            detail: 'Local workflow matches the generated template.',
          }
        : {
            status: 'drifted',
            detail: 'Local workflow exists but differs from the generated template.',
          };
    } catch (error) {
      if (this.isMissingFileError(error)) {
        return {
          status: 'missing',
          detail: 'Expected workflow file was not found in the connected local checkout.',
        };
      }

      return {
        status: 'unknown',
        detail: `Workflow installation could not be verified: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private normalizeWorkflowContent(content: string): string {
    return content.trim().replace(/\r\n/g, '\n');
  }

  private isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
  }
}
