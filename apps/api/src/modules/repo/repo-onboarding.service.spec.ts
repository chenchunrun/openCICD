import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HighRiskPathService } from './high-risk-path.service';
import { LanguageDetectorService } from './language-detector.service';
import { RepoOnboardingService } from './repo-onboarding.service';
import type { RepoService } from './repo.service';

describe('RepoOnboardingService', () => {
  let service: RepoOnboardingService;
  let repoServiceMock: jest.Mocked<RepoService>;

  beforeEach(() => {
    repoServiceMock = {
      findByFullName: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    } as unknown as jest.Mocked<RepoService>;

    service = new RepoOnboardingService(
      repoServiceMock,
      new LanguageDetectorService(),
      new HighRiskPathService(),
    );
  });

  it('scans localPath and infers scripts and repo markers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aicp-repo-onboarding-'));

    try {
      await writeFile(
        join(root, 'package.json'),
        JSON.stringify({
          packageManager: 'pnpm@9.0.0',
          scripts: {
            test: 'vitest run',
            lint: 'eslint .',
            typecheck: 'tsc --noEmit',
            build: 'turbo build',
          },
        }),
      );
      await writeFile(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0');
      await writeFile(join(root, 'AGENTS.md'), '# Agents');
      await writeFile(join(root, 'CLAUDE.md'), '# Claude');
      await mkdir(join(root, '.ai-cicd'));
      await mkdir(join(root, '.github'));
      await writeFile(join(root, '.github', 'CODEOWNERS'), '* @team');

      repoServiceMock.findByFullName.mockResolvedValue(null);
      repoServiceMock.create.mockImplementation(async (data) => ({ id: 'repo-1', ...data }) as any);

      const result = await service.onboard({
        platform: 'github',
        owner: 'acme',
        name: 'demo',
        url: 'https://github.com/acme/demo',
        localPath: root,
      });

      expect(repoServiceMock.create).toHaveBeenCalledWith(
        expect.objectContaining({
          localPath: root,
          languages: ['typescript'],
          packageManager: 'pnpm',
          testCommand: 'pnpm test',
          lintCommand: 'pnpm lint',
          typecheckCommand: 'pnpm typecheck',
          buildCommand: 'pnpm build',
          codeownersPath: '.github/CODEOWNERS',
          hasAgentsMd: true,
          hasClaudeMd: true,
          hasAiCicdDir: true,
        }),
      );
      expect(result).toEqual(expect.objectContaining({ id: 'repo-1', fullName: 'acme/demo' }));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('updates an existing repo with the latest local scan metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aicp-repo-onboarding-'));

    try {
      await writeFile(
        join(root, 'package.json'),
        JSON.stringify({
          scripts: {
            test: 'jest',
          },
        }),
      );

      repoServiceMock.findByFullName.mockResolvedValue({
        id: 'repo-1',
        defaultBranch: 'main',
        localPath: null,
      } as any);
      repoServiceMock.update.mockImplementation(async (_id, data) => ({ id: 'repo-1', ...data }) as any);

      const result = await service.onboard({
        platform: 'github',
        owner: 'acme',
        name: 'demo',
        url: 'https://github.com/acme/demo',
        localPath: root,
      });

      expect(repoServiceMock.create).not.toHaveBeenCalled();
      expect(repoServiceMock.update).toHaveBeenCalledWith(
        'repo-1',
        expect.objectContaining({
          localPath: root,
          languages: ['typescript'],
          testCommand: 'npm test',
        }),
      );
      expect(result).toEqual(expect.objectContaining({ id: 'repo-1', localPath: root }));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
