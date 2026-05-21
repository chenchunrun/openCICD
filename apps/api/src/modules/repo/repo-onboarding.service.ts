import { BadRequestException, Injectable } from '@nestjs/common';
import { access, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { RepoService } from './repo.service.js';
import { LanguageDetectorService } from './language-detector.service.js';
import { HighRiskPathService } from './high-risk-path.service.js';

export interface OnboardInput {
  platform: string;
  owner: string;
  name: string;
  url: string;
  defaultBranch?: string;
  localPath?: string;
}

@Injectable()
export class RepoOnboardingService {
  constructor(
    private readonly repoService: RepoService,
    private readonly languageDetector: LanguageDetectorService,
    private readonly highRiskPathService: HighRiskPathService,
  ) {}

  async onboard(input: OnboardInput) {
    const fullName = `${input.owner}/${input.name}`;
    const scan = await this.scanRepository(input.localPath);
    const highRiskPaths = this.highRiskPathService.getDefaultHighRiskPaths();
    const existing = await this.repoService.findByFullName(fullName);
    if (existing) {
      return this.repoService.update(existing.id, {
        defaultBranch: input.defaultBranch ?? existing.defaultBranch,
        localPath: input.localPath ?? existing.localPath ?? null,
        languages: scan.languageStack.languages,
        packageManager: scan.languageStack.packageManager,
        testCommand: scan.languageStack.testCommand,
        lintCommand: scan.languageStack.lintCommand,
        typecheckCommand: scan.languageStack.typecheckCommand,
        buildCommand: scan.languageStack.buildCommand,
        codeownersPath: scan.codeownersPath ?? null,
        highRiskPaths,
        hasAgentsMd: scan.hasAgentsMd,
        hasClaudeMd: scan.hasClaudeMd,
        hasAiCicdDir: scan.hasAiCicdDir,
      });
    }

    return this.repoService.create({
      platform: input.platform,
      owner: input.owner,
      name: input.name,
      fullName,
      url: input.url,
      defaultBranch: input.defaultBranch ?? 'main',
      localPath: input.localPath,
      languages: scan.languageStack.languages,
      packageManager: scan.languageStack.packageManager,
      testCommand: scan.languageStack.testCommand,
      lintCommand: scan.languageStack.lintCommand,
      typecheckCommand: scan.languageStack.typecheckCommand,
      buildCommand: scan.languageStack.buildCommand,
      codeownersPath: scan.codeownersPath,
      highRiskPaths,
      hasAgentsMd: scan.hasAgentsMd,
      hasClaudeMd: scan.hasClaudeMd,
      hasAiCicdDir: scan.hasAiCicdDir,
    });
  }

  private async scanRepository(localPath?: string): Promise<{
    languageStack: ReturnType<LanguageDetectorService['detectDefault']>;
    codeownersPath?: string;
    hasAgentsMd: boolean;
    hasClaudeMd: boolean;
    hasAiCicdDir: boolean;
  }> {
    if (!localPath) {
      return {
        languageStack: this.languageDetector.detectDefault(),
        hasAgentsMd: false,
        hasClaudeMd: false,
        hasAiCicdDir: false,
      };
    }

    const topLevelFiles = await this.readTopLevelEntries(localPath);
    const fileContents = await this.readKnownManifestContents(localPath, topLevelFiles);
    const languageStack = this.languageDetector.detectFromProject(topLevelFiles, fileContents);

    return {
      languageStack: languageStack.languages.length > 0 ? languageStack : this.languageDetector.detectDefault(),
      codeownersPath: await this.findFirstExisting(localPath, ['CODEOWNERS', '.github/CODEOWNERS', 'docs/CODEOWNERS']),
      hasAgentsMd: topLevelFiles.includes('AGENTS.md'),
      hasClaudeMd: topLevelFiles.includes('CLAUDE.md'),
      hasAiCicdDir: topLevelFiles.includes('.ai-cicd'),
    };
  }

  private async readTopLevelEntries(localPath: string): Promise<string[]> {
    try {
      const entries = await readdir(localPath, { withFileTypes: true });
      return entries.map((entry) => entry.name);
    } catch (error) {
      throw new BadRequestException(
        `Unable to scan localPath "${localPath}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async readKnownManifestContents(
    localPath: string,
    topLevelFiles: string[],
  ): Promise<Record<string, string>> {
    const readableFiles = ['package.json', 'pyproject.toml'];
    const contents: Record<string, string> = {};

    await Promise.all(
      readableFiles
        .filter((fileName) => topLevelFiles.includes(fileName))
        .map(async (fileName) => {
          try {
            contents[fileName] = await readFile(join(localPath, fileName), 'utf8');
          } catch {
            // Ignore unreadable manifests and keep heuristic detection.
          }
        }),
    );

    return contents;
  }

  private async findFirstExisting(localPath: string, relativePaths: string[]): Promise<string | undefined> {
    for (const relativePath of relativePaths) {
      try {
        await access(join(localPath, relativePath));
        return relativePath;
      } catch {
        continue;
      }
    }

    return undefined;
  }
}
