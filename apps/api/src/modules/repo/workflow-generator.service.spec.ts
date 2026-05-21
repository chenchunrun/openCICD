import { parse as yamlParse } from 'yaml';
import { WorkflowGeneratorService } from './workflow-generator.service';

describe('WorkflowGeneratorService', () => {
  let service: WorkflowGeneratorService;

  beforeEach(() => {
    service = new WorkflowGeneratorService();
  });

  it('generates the full workflow set expected by the MVP plan', () => {
    const workflows = service.generateAllWorkflows();

    expect(Object.keys(workflows).sort()).toEqual([
      'ai-agent-run.yml',
      'ai-evidence.yml',
      'ai-intent-gate.yml',
      'ai-policy-test.yml',
      'ai-release.yml',
      'ai-repair.yml',
      'ai-review.yml',
    ]);
  });

  it('exports review workflow with review artifact upload', () => {
    const parsed = yamlParse(service.generateReviewWorkflow()) as {
      jobs: Record<string, { steps: Array<Record<string, unknown>> }>;
    };

    expect(parsed.jobs['review-export']).toBeDefined();
    expect(parsed.jobs['review-export']?.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Fetch GitHub review payload',
        }),
        expect.objectContaining({
          uses: 'actions/upload-artifact@v4',
        }),
      ]),
    );
  });

  it('exports release workflow with gate and plan artifacts', () => {
    const parsed = yamlParse(service.generateReleaseWorkflow()) as {
      jobs: Record<string, { steps: Array<Record<string, unknown>> }>;
    };

    const steps = parsed.jobs['release-gate']?.steps ?? [];
    expect(steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Fetch release gate',
        }),
        expect.objectContaining({
          name: 'Fetch release plan',
        }),
      ]),
    );
  });
});
