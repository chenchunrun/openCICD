import { parse as yamlParse } from 'yaml';
import { WorkflowGeneratorService } from './workflow-generator.service';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('WorkflowGeneratorService', () => {
  let service: WorkflowGeneratorService;

  beforeEach(() => {
    service = new WorkflowGeneratorService();
  });

  it('generates the full workflow set expected by the MVP plan', () => {
    const workflows = service.generateAllWorkflows();
    const definitions = service.generateWorkflowDefinitions();

    expect(Object.keys(workflows).sort()).toEqual([
      'ai-agent-run.yml',
      'ai-evidence.yml',
      'ai-intent-gate.yml',
      'ai-policy-test.yml',
      'ai-release.yml',
      'ai-repair.yml',
      'ai-review.yml',
    ]);
    expect(definitions).toHaveLength(7);
    expect(definitions[0]).toEqual(
      expect.objectContaining({
        filename: expect.any(String),
        displayName: expect.any(String),
        purpose: expect.any(String),
        installPath: expect.stringMatching(/^\.github\/workflows\//),
        triggers: expect.any(Array),
        requiredSecrets: ['AICP_API_URL'],
        content: expect.any(String),
      }),
    );
    expect(definitions.map((definition) => definition.filename).sort()).toEqual(
      Object.keys(workflows).sort(),
    );
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

  it('marks workflows as missing when the connected checkout does not contain them', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workflow-generator-'));

    const definitions = await service.inspectWorkflowDefinitions(root);
    const releaseWorkflow = definitions.find((definition) => definition.filename === 'ai-release.yml');

    expect(releaseWorkflow?.installation).toEqual({
      status: 'missing',
      detail: 'Expected workflow file was not found in the connected local checkout.',
    });
    expect(releaseWorkflow?.secrets).toEqual([
      expect.objectContaining({
        name: 'AICP_API_URL',
        status: 'required_but_unverified',
      }),
    ]);
  });

  it('marks workflows as installed when the local checkout matches the generated template', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workflow-generator-'));
    await mkdir(join(root, '.github', 'workflows'), { recursive: true });
    await writeFile(
      join(root, '.github', 'workflows', 'ai-release.yml'),
      service.generateReleaseWorkflow(),
      'utf8',
    );

    const definitions = await service.inspectWorkflowDefinitions(root);
    const releaseWorkflow = definitions.find((definition) => definition.filename === 'ai-release.yml');

    expect(releaseWorkflow?.installation).toEqual({
      status: 'installed',
      detail: 'Local workflow matches the generated template.',
    });
  });
});
