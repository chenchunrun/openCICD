import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CliAgentRuntimeService } from './cli-agent-runtime.service';
import type { AgentRunPlan } from '@aicp/shared';

describe('CliAgentRuntimeService', () => {
  let service: CliAgentRuntimeService;

  beforeEach(() => {
    service = new CliAgentRuntimeService();
  });

  it('collects snapshot diff outside git repositories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aicp-runtime-'));

    try {
      await writeFile(join(root, 'existing.txt'), 'before\n');
      await writeFile(join(root, 'deleted.txt'), 'remove me\n');

      const plan: AgentRunPlan = {
        runId: 'run-1',
        taskId: 'task-1',
        agentName: 'codex',
        branch: 'ai/task-task-1',
        sandboxDir: root,
        workingDirectory: root,
        filesystemMode: 'workspace_write',
        networkMode: 'disabled',
        networkDomains: [],
        command: process.execPath,
        args: [
          '-e',
          [
            "const fs = require('node:fs');",
            "fs.writeFileSync('existing.txt', 'after\\nchanged\\n');",
            "fs.writeFileSync('added.txt', 'new file\\n');",
            "fs.rmSync('deleted.txt');",
          ].join(' '),
        ],
        env: {},
        timeoutMs: 5_000,
      };

      const stream = await service.execute(plan, 'started');
      for await (const _event of stream) {
        // Drain the process event stream until completion.
      }

      const diff = await service.collectDiff('run-1');

      expect(diff.summary.changedFiles).toBe(3);
      expect(diff.files).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: 'existing.txt',
            status: 'modified',
          }),
          expect.objectContaining({
            path: 'added.txt',
            status: 'added',
          }),
          expect.objectContaining({
            path: 'deleted.txt',
            status: 'deleted',
          }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('executes inside sandboxDir without mutating source workspace', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'aicp-runtime-workspace-'));
    const sandboxRoot = await mkdtemp(join(tmpdir(), 'aicp-runtime-sandbox-'));

    try {
      await writeFile(join(workspaceRoot, 'tracked.txt'), 'source only\n');

      const plan: AgentRunPlan = {
        runId: 'run-2',
        taskId: 'task-2',
        agentName: 'codex',
        branch: 'ai/task-task-2',
        sandboxDir: sandboxRoot,
        workingDirectory: workspaceRoot,
        filesystemMode: 'workspace_write',
        networkMode: 'disabled',
        networkDomains: [],
        command: process.execPath,
        args: [
          '-e',
          [
            "const fs = require('node:fs');",
            "fs.writeFileSync('tracked.txt', 'sandbox edit\\n');",
            "fs.writeFileSync('sandbox-only.txt', 'created in sandbox\\n');",
          ].join(' '),
        ],
        env: {},
        timeoutMs: 5_000,
      };

      const stream = await service.execute(plan, 'started');
      for await (const _event of stream) {
        // Drain until completion.
      }

      expect(await readFile(join(workspaceRoot, 'tracked.txt'), 'utf8')).toBe('source only\n');
      expect(await readFile(join(sandboxRoot, 'tracked.txt'), 'utf8')).toBe('sandbox edit\n');

      const diff = await service.collectDiff('run-2');
      expect(diff.files).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: 'tracked.txt', status: 'modified' }),
          expect.objectContaining({ path: 'sandbox-only.txt', status: 'added' }),
        ]),
      );

      await service.cleanup('run-2');
      await expect(access(sandboxRoot)).rejects.toThrow();
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
      await rm(sandboxRoot, { recursive: true, force: true });
    }
  });

  it('uses git worktree when the source workspace is a git repository', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'aicp-runtime-git-workspace-'));
    const sandboxRoot = await mkdtemp(join(tmpdir(), 'aicp-runtime-git-sandbox-'));

    try {
      await writeFile(join(workspaceRoot, 'tracked.txt'), 'source only\n');
      execFileSync('git', ['init'], { cwd: workspaceRoot, env: process.env });
      execFileSync('git', ['add', 'tracked.txt'], { cwd: workspaceRoot, env: process.env });
      execFileSync(
        'git',
        [
          '-c',
          'user.name=AI Control Plane',
          '-c',
          'user.email=aicp@example.com',
          'commit',
          '-m',
          'initial',
        ],
        { cwd: workspaceRoot, env: process.env },
      );

      const plan: AgentRunPlan = {
        runId: 'run-3',
        taskId: 'task-3',
        agentName: 'codex',
        branch: 'ai/task-task-3',
        sandboxDir: sandboxRoot,
        workingDirectory: workspaceRoot,
        filesystemMode: 'workspace_write',
        networkMode: 'disabled',
        networkDomains: [],
        command: process.execPath,
        args: [
          '-e',
          [
            "const fs = require('node:fs');",
            "fs.writeFileSync('tracked.txt', 'sandbox edit\\n');",
          ].join(' '),
        ],
        env: {},
        timeoutMs: 5_000,
      };

      const stream = await service.execute(plan, 'started');
      for await (const _event of stream) {
        // Drain until completion.
      }

      expect(await readFile(join(workspaceRoot, 'tracked.txt'), 'utf8')).toBe('source only\n');
      expect(await readFile(join(sandboxRoot, 'tracked.txt'), 'utf8')).toBe('sandbox edit\n');
      await expect(access(join(sandboxRoot, '.git'))).resolves.toBeUndefined();

      const diff = await service.collectDiff('run-3');
      expect(diff.files).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: 'tracked.txt', status: 'modified' }),
        ]),
      );

      await service.cleanup('run-3');
      await expect(access(sandboxRoot)).rejects.toThrow();
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
      await rm(sandboxRoot, { recursive: true, force: true });
    }
  });

  it('stops a hung process after the idle timeout elapses', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aicp-runtime-idle-'));

    try {
      const plan: AgentRunPlan = {
        runId: 'run-4',
        taskId: 'task-4',
        agentName: 'claude_code',
        branch: 'ai/task-task-4',
        sandboxDir: root,
        workingDirectory: root,
        filesystemMode: 'workspace_write',
        networkMode: 'disabled',
        networkDomains: [],
        command: process.execPath,
        args: ['-e', "setTimeout(() => {}, 5_000);"],
        env: {},
        timeoutMs: 5_000,
        idleTimeoutMs: 100,
      };

      const events: Array<{ type: string; data: Record<string, unknown> }> = [];
      const stream = await service.execute(plan, 'started');
      for await (const event of stream) {
        events.push(event);
      }

      const evidence = await service.collectEvidence('run-4');

      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'error',
            data: expect.objectContaining({
              message: expect.stringContaining('became idle'),
            }),
          }),
          expect.objectContaining({
            type: 'status',
            data: expect.objectContaining({
              timedOut: true,
              idleTimedOut: true,
              succeeded: false,
            }),
          }),
        ]),
      );
      expect(evidence.timedOut).toBe(true);
      expect(evidence.succeeded).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('enforces read-only filesystem mode inside the sandbox', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'aicp-runtime-readonly-workspace-'));
    const sandboxRoot = await mkdtemp(join(tmpdir(), 'aicp-runtime-readonly-sandbox-'));

    try {
      await writeFile(join(workspaceRoot, 'tracked.txt'), 'source only\n');

      const plan: AgentRunPlan = {
        runId: 'run-5',
        taskId: 'task-5',
        agentName: 'codex',
        branch: 'ai/task-task-5',
        sandboxDir: sandboxRoot,
        workingDirectory: workspaceRoot,
        filesystemMode: 'read_only',
        networkMode: 'disabled',
        networkDomains: [],
        command: process.execPath,
        args: [
          '-e',
          [
            "const fs = require('node:fs');",
            "try {",
            "  fs.writeFileSync('tracked.txt', 'mutated\\n');",
            "  process.exit(0);",
            "} catch (error) {",
            "  console.error(error && error.code ? error.code : String(error));",
            "  process.exit(13);",
            "}",
          ].join(' '),
        ],
        env: {},
        timeoutMs: 5_000,
      };

      const stream = await service.execute(plan, 'started');
      for await (const _event of stream) {
        // Drain until completion.
      }

      expect(await readFile(join(workspaceRoot, 'tracked.txt'), 'utf8')).toBe('source only\n');

      const evidence = await service.collectEvidence('run-5');
      expect(evidence.succeeded).toBe(false);
      expect(evidence.exitCode).toBe(13);

      await service.cleanup('run-5');
      await expect(access(sandboxRoot)).rejects.toThrow();
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
      await rm(sandboxRoot, { recursive: true, force: true });
    }
  });

  it('strips proxy variables and enables offline flags when network is disabled', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aicp-runtime-network-disabled-'));

    try {
      const plan: AgentRunPlan = {
        runId: 'run-6',
        taskId: 'task-6',
        agentName: 'codex',
        branch: 'ai/task-task-6',
        sandboxDir: root,
        workingDirectory: root,
        filesystemMode: 'workspace_write',
        networkMode: 'disabled',
        networkDomains: [],
        command: process.execPath,
        args: [
          '-e',
          [
            "const payload = {",
            "  httpProxy: process.env.HTTP_PROXY ?? null,",
            "  httpsProxy: process.env.HTTPS_PROXY ?? null,",
            "  npmOffline: process.env.npm_config_offline ?? null,",
            "  yarnOffline: process.env.YARN_ENABLE_OFFLINE_MODE ?? null,",
            "  pnpmOffline: process.env.PNPM_OFFLINE ?? null,",
            "  bunOffline: process.env.BUN_INSTALL_OFFLINE ?? null,",
            "  networkMode: process.env.AICP_NETWORK_MODE ?? null,",
            "  allowedDomains: process.env.AICP_NETWORK_ALLOWED_DOMAINS ?? null,",
            "};",
            'console.log(JSON.stringify(payload));',
          ].join(' '),
        ],
        env: {
          HTTP_PROXY: 'http://proxy.example.test:8080',
          HTTPS_PROXY: 'http://proxy.example.test:8443',
        },
        timeoutMs: 5_000,
      };

      const stream = await service.execute(plan, 'started');
      for await (const _event of stream) {
        // Drain until completion.
      }

      const evidence = await service.collectEvidence('run-6');
      expect(evidence.succeeded).toBe(true);

      const output = service['records'].get('run-6')?.stdout.join('') ?? '';
      const parsed = JSON.parse(output.trim()) as Record<string, string | null>;
      expect(parsed).toMatchObject({
        httpProxy: null,
        httpsProxy: null,
        npmOffline: 'true',
        yarnOffline: '1',
        pnpmOffline: 'true',
        bunOffline: '1',
        networkMode: 'disabled',
        allowedDomains: '',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
