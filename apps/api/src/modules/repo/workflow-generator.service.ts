import { Injectable } from '@nestjs/common';
import { stringify as yamlStringify } from 'yaml';

@Injectable()
export class WorkflowGeneratorService {
  private readonly checkoutStep = { uses: 'actions/checkout@v4' };
  private readonly setupCurlStep = {
    name: 'Prepare API access',
    run: 'test -n "${{ secrets.AICP_API_URL }}"',
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

  generateAllWorkflows(): Record<string, string> {
    return {
      'ai-intent-gate.yml': this.generateIntentGateWorkflow(),
      'ai-agent-run.yml': this.generateAgentRunWorkflow(),
      'ai-review.yml': this.generateReviewWorkflow(),
      'ai-repair.yml': this.generateRepairWorkflow(),
      'ai-policy-test.yml': this.generatePolicyTestWorkflow(),
      'ai-evidence.yml': this.generateEvidenceWorkflow(),
      'ai-release.yml': this.generateReleaseWorkflow(),
    };
  }
}
