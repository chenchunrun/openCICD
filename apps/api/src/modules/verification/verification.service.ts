import { Injectable } from '@nestjs/common';
import { access, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { CommandRunnerService, type CommandExecutionResult } from './command-runner.service.js';
import { DependencyScanService } from './dependency-scan.service.js';
import { LicenseScanService } from './license-scan.service.js';
import { SecretScanService } from './secret-scan.service.js';
import { SastScanService } from './sast-scan.service.js';
import { TestSelectionService } from './test-selection.service.js';
import { TestWeakeningDetectorService } from './test-weakening-detector.service.js';

export type VerificationCheckName =
  | 'lint'
  | 'typecheck'
  | 'build'
  | 'unit_tests'
  | 'secret_scan'
  | 'sast_scan'
  | 'dependency_scan'
  | 'license_scan'
  | 'test_selection'
  | 'test_weakening_check';

export interface VerificationResult {
  passed: boolean;
  checks: Record<string, 'passed' | 'failed' | 'skipped'>;
  commandResults: Partial<Record<'lint' | 'typecheck' | 'build' | 'unit_tests', CommandExecutionResult>>;
  testWeakeningDetected: boolean;
  secretScanDetected?: boolean;
  secretScanFindings?: Array<{ type: string; match: string }>;
  sastScanDetected?: boolean;
  sastScanFindings?: Array<{ type: string; match: string }>;
  dependencyScanDetected?: boolean;
  dependencyScanFindings?: Array<{ type: string; match: string }>;
  licenseScanDetected?: boolean;
  licenseScanFindings?: Array<{ type: string; match: string }>;
}

export interface VerificationObserver {
  onCheckStarted?: (checkName: VerificationCheckName, command?: string) => Promise<void> | void;
  onCheckCompleted?: (
    checkName: VerificationCheckName,
    status: 'passed' | 'failed' | 'skipped',
    result?: CommandExecutionResult,
  ) => Promise<void> | void;
}

interface VerificationConfig {
  testCommand?: string;
  lintCommand?: string;
  typecheckCommand?: string;
  buildCommand?: string;
  focusPaths?: string[];
  brokeredContext?: Record<string, unknown>;
}

interface ResolvedVerificationConfig {
  workingDirectory: string;
  testCommand?: string;
  lintCommand?: string;
  typecheckCommand?: string;
  buildCommand?: string;
}

@Injectable()
export class VerificationService {
  constructor(
    private readonly commandRunner: CommandRunnerService,
    private readonly secretScan: SecretScanService,
    private readonly sastScan: SastScanService,
    private readonly dependencyScan: DependencyScanService,
    private readonly licenseScan: LicenseScanService,
    private readonly testSelection: TestSelectionService,
    private readonly testWeakeningDetector: TestWeakeningDetectorService,
  ) {}

  async runChecks(
    repoConfig: VerificationConfig,
    changedFiles: string[],
    diff: string,
    workingDirectory = process.cwd(),
    observer?: VerificationObserver,
  ): Promise<VerificationResult> {
    const resolvedConfig = await this.resolveVerificationConfig(repoConfig, changedFiles, workingDirectory);
    const checks: Record<string, 'passed' | 'failed' | 'skipped'> = {};
    const commandResults: VerificationResult['commandResults'] = {};
    const selectedTests = this.testSelection.selectTests(changedFiles);
    const weakeningResult = this.testWeakeningDetector.detect(diff);
    const secretScanResult = this.secretScan.scan(diff);
    const sastScanResult = this.sastScan.scan(diff);
    const dependencyScanResult = this.dependencyScan.scan(diff);
    const licenseScanResult = this.licenseScan.scan(diff);

    checks['test_selection'] = selectedTests.length > 0 ? 'passed' : 'skipped';
    await observer?.onCheckCompleted?.('test_selection', checks['test_selection']);
    checks['test_weakening_check'] = weakeningResult.detected ? 'failed' : 'passed';
    await observer?.onCheckCompleted?.('test_weakening_check', checks['test_weakening_check']);
    checks['secret_scan'] = secretScanResult.detected ? 'failed' : 'passed';
    await observer?.onCheckCompleted?.('secret_scan', checks['secret_scan']);
    checks['sast_scan'] = sastScanResult.detected ? 'failed' : 'passed';
    await observer?.onCheckCompleted?.('sast_scan', checks['sast_scan']);
    checks['dependency_scan'] = dependencyScanResult.detected ? 'failed' : 'passed';
    await observer?.onCheckCompleted?.('dependency_scan', checks['dependency_scan']);
    checks['license_scan'] = licenseScanResult.detected ? 'failed' : 'passed';
    await observer?.onCheckCompleted?.('license_scan', checks['license_scan']);

    if (
      !weakeningResult.detected &&
      !secretScanResult.detected &&
      !sastScanResult.detected &&
      !dependencyScanResult.detected &&
      !licenseScanResult.detected
    ) {
      await this.runConfiguredCheck(
        'lint',
        resolvedConfig.lintCommand,
        resolvedConfig.workingDirectory,
        checks,
        commandResults,
        observer,
      );
      await this.runConfiguredCheck(
        'typecheck',
        resolvedConfig.typecheckCommand,
        resolvedConfig.workingDirectory,
        checks,
        commandResults,
        observer,
      );
      await this.runConfiguredCheck(
        'build',
        resolvedConfig.buildCommand,
        resolvedConfig.workingDirectory,
        checks,
        commandResults,
        observer,
      );
      await this.runConfiguredCheck(
        'unit_tests',
        resolvedConfig.testCommand,
        resolvedConfig.workingDirectory,
        checks,
        commandResults,
        observer,
      );
    } else {
      if (resolvedConfig.lintCommand) {
        checks['lint'] = 'skipped';
        await observer?.onCheckCompleted?.('lint', 'skipped');
      }
      if (resolvedConfig.typecheckCommand) {
        checks['typecheck'] = 'skipped';
        await observer?.onCheckCompleted?.('typecheck', 'skipped');
      }
      if (resolvedConfig.buildCommand) {
        checks['build'] = 'skipped';
        await observer?.onCheckCompleted?.('build', 'skipped');
      }
      if (resolvedConfig.testCommand) {
        checks['unit_tests'] = 'skipped';
        await observer?.onCheckCompleted?.('unit_tests', 'skipped');
      }
    }

    return {
      passed: !weakeningResult.detected && Object.values(checks).every((v) => v !== 'failed'),
      checks,
      commandResults,
      testWeakeningDetected: weakeningResult.detected,
      secretScanDetected: secretScanResult.detected,
      secretScanFindings: secretScanResult.findings,
      sastScanDetected: sastScanResult.detected,
      sastScanFindings: sastScanResult.findings,
      dependencyScanDetected: dependencyScanResult.detected,
      dependencyScanFindings: dependencyScanResult.findings,
      licenseScanDetected: licenseScanResult.detected,
      licenseScanFindings: licenseScanResult.findings,
    };
  }

  private async resolveVerificationConfig(
    repoConfig: VerificationConfig,
    changedFiles: string[],
    workingDirectory: string,
  ): Promise<ResolvedVerificationConfig> {
    const focusPaths = repoConfig.focusPaths?.length
      ? repoConfig.focusPaths
      : this.extractBrokeredFocusPaths(repoConfig.brokeredContext);
    const scopedPackageDir = await this.findScopedPackageDirectory(
      workingDirectory,
      changedFiles,
      focusPaths,
    );

    if (!scopedPackageDir) {
      return {
        workingDirectory,
        testCommand: repoConfig.testCommand,
        lintCommand: repoConfig.lintCommand,
        typecheckCommand: repoConfig.typecheckCommand,
        buildCommand: repoConfig.buildCommand,
      };
    }

    const packageJson = await this.readPackageJson(scopedPackageDir);
    if (!packageJson) {
      return {
        workingDirectory,
        testCommand: repoConfig.testCommand,
        lintCommand: repoConfig.lintCommand,
        typecheckCommand: repoConfig.typecheckCommand,
        buildCommand: repoConfig.buildCommand,
      };
    }

    const packageManager = await this.detectNodePackageManager(
      workingDirectory,
      scopedPackageDir,
      packageJson.packageManager,
    );
    const dependencies = {
      ...(packageJson.dependencies ?? {}),
      ...(packageJson.devDependencies ?? {}),
    };
    const scripts = packageJson.scripts ?? {};

    return {
      workingDirectory: scopedPackageDir,
      testCommand: this.resolveNodeScriptCommand(packageManager, scripts, dependencies, 'test'),
      lintCommand: this.resolveNodeScriptCommand(packageManager, scripts, dependencies, 'lint'),
      typecheckCommand: this.resolveNodeScriptCommand(packageManager, scripts, dependencies, 'typecheck'),
      buildCommand: this.resolveNodeScriptCommand(packageManager, scripts, dependencies, 'build'),
    };
  }

  private extractBrokeredFocusPaths(brokeredContext?: Record<string, unknown>): string[] {
    const scope =
      brokeredContext?.scope && typeof brokeredContext.scope === 'object'
        ? (brokeredContext.scope as Record<string, unknown>)
        : null;
    const allowedPaths = scope?.allowedPaths;
    if (!Array.isArray(allowedPaths)) {
      return [];
    }

    return allowedPaths.filter((entry): entry is string => typeof entry === 'string');
  }

  private async runConfiguredCheck(
    checkName: 'lint' | 'typecheck' | 'build' | 'unit_tests',
    command: string | undefined,
    workingDirectory: string,
    checks: Record<string, 'passed' | 'failed' | 'skipped'>,
    commandResults: VerificationResult['commandResults'],
    observer?: VerificationObserver,
  ): Promise<void> {
    if (!command) {
      checks[checkName] = 'skipped';
      await observer?.onCheckCompleted?.(checkName, 'skipped');
      return;
    }

    await observer?.onCheckStarted?.(checkName, command);
    const result = await this.commandRunner.run(command, workingDirectory);
    commandResults[checkName] = result;
    checks[checkName] = result.success ? 'passed' : 'failed';
    await observer?.onCheckCompleted?.(checkName, checks[checkName], result);
  }

  private async findScopedPackageDirectory(
    workingDirectory: string,
    changedFiles: string[],
    focusPaths: string[],
  ): Promise<string | null> {
    const candidates = new Set<string>();

    for (const inputPath of [...changedFiles, ...focusPaths]) {
      const packageDir = await this.findNearestPackageDirectory(workingDirectory, inputPath);
      if (packageDir) {
        candidates.add(packageDir);
      }
    }

    return candidates.size === 1 ? [...candidates][0] ?? null : null;
  }

  private async findNearestPackageDirectory(workingDirectory: string, rawPath: string): Promise<string | null> {
    const sanitizedPath = this.trimGlobPath(rawPath);
    if (!sanitizedPath) {
      return null;
    }

    let currentRelativePath = this.looksLikeFilePath(sanitizedPath) ? dirname(sanitizedPath) : sanitizedPath;
    while (currentRelativePath !== '.' && currentRelativePath !== '') {
      const manifestPath = join(workingDirectory, currentRelativePath, 'package.json');
      if (await this.pathExists(manifestPath)) {
        return join(workingDirectory, currentRelativePath);
      }
      currentRelativePath = dirname(currentRelativePath);
    }

    return (await this.pathExists(join(workingDirectory, 'package.json'))) ? workingDirectory : null;
  }

  private async readPackageJson(directory: string): Promise<{
    scripts?: Record<string, string>;
    packageManager?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  } | null> {
    try {
      const raw = await readFile(join(directory, 'package.json'), 'utf8');
      return JSON.parse(raw) as {
        scripts?: Record<string, string>;
        packageManager?: string;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
    } catch {
      return null;
    }
  }

  private async detectNodePackageManager(
    workingDirectory: string,
    packageDirectory: string,
    rawPackageManager?: string,
  ): Promise<'pnpm' | 'npm' | 'yarn' | 'bun'> {
    const normalized = rawPackageManager?.split('@')[0];
    if (normalized === 'pnpm' || normalized === 'npm' || normalized === 'yarn' || normalized === 'bun') {
      return normalized;
    }

    let currentDirectory = packageDirectory;
    while (currentDirectory.startsWith(workingDirectory)) {
      const packageJson = await this.readPackageJson(currentDirectory);
      const nestedPackageManager = packageJson?.packageManager?.split('@')[0];
      if (
        nestedPackageManager === 'pnpm' ||
        nestedPackageManager === 'npm' ||
        nestedPackageManager === 'yarn' ||
        nestedPackageManager === 'bun'
      ) {
        return nestedPackageManager;
      }

      if (await this.pathExists(join(currentDirectory, 'pnpm-lock.yaml'))) return 'pnpm';
      if (await this.pathExists(join(currentDirectory, 'package-lock.json'))) return 'npm';
      if (await this.pathExists(join(currentDirectory, 'yarn.lock'))) return 'yarn';
      if (await this.pathExists(join(currentDirectory, 'bun.lockb'))) return 'bun';

      if (currentDirectory === workingDirectory) {
        break;
      }
      currentDirectory = dirname(currentDirectory);
    }

    return 'npm';
  }

  private resolveNodeScriptCommand(
    packageManager: 'pnpm' | 'npm' | 'yarn' | 'bun',
    scripts: Record<string, string>,
    dependencies: Record<string, string>,
    scriptName: 'test' | 'lint' | 'typecheck' | 'build',
  ): string | undefined {
    const script = scripts[scriptName];
    if (!script || !this.isNodeScriptRunnable(script, dependencies)) {
      return undefined;
    }

    switch (packageManager) {
      case 'pnpm':
        return scriptName === 'test' ? 'pnpm test' : `pnpm ${scriptName}`;
      case 'yarn':
        return `yarn ${scriptName}`;
      case 'bun':
        return scriptName === 'test' ? 'bun test' : `bun run ${scriptName}`;
      case 'npm':
      default:
        return scriptName === 'test' ? 'npm test' : `npm run ${scriptName}`;
    }
  }

  private isNodeScriptRunnable(script: string, dependencies: Record<string, string>): boolean {
    const firstToken = script.trim().split(/\s+/)[0];
    if (!firstToken) {
      return false;
    }

    const builtinCommands = new Set(['npm', 'pnpm', 'yarn', 'bun', 'node', 'sh', 'bash', 'env', 'echo', 'git']);
    if (builtinCommands.has(firstToken)) {
      return true;
    }

    const binaryPackageMap: Record<string, string[]> = {
      eslint: ['eslint'],
      jest: ['jest'],
      nest: ['@nestjs/cli'],
      next: ['next'],
      tsc: ['typescript'],
      tsx: ['tsx'],
      'ts-node': ['ts-node'],
      vite: ['vite'],
      vitest: ['vitest'],
    };
    const requiredPackages = binaryPackageMap[firstToken];
    if (!requiredPackages) {
      return true;
    }

    return requiredPackages.some((dependencyName) => dependencyName in dependencies);
  }

  private trimGlobPath(rawPath: string): string {
    const wildcardIndex = rawPath.search(/[*?[{]/);
    const trimmed = wildcardIndex >= 0 ? rawPath.slice(0, wildcardIndex) : rawPath;
    return trimmed.replace(/^\/+/, '').replace(/\/+$/, '').trim();
  }

  private looksLikeFilePath(candidate: string): boolean {
    const lastSegment = candidate.split('/').filter(Boolean).at(-1) ?? '';
    return lastSegment.includes('.');
  }

  private async pathExists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }
}
