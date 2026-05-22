import { Injectable } from '@nestjs/common';
import { spawn, type ChildProcess } from 'node:child_process';
import { access, chmod, cp, lstat, mkdir, readdir, readFile, rm, symlink } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { matchAnyGlob } from '@aicp/shared';
import type { AgentEvidence, AgentRunPlan, DiffFile, GitDiff } from '@aicp/shared';

interface SnapshotEntry {
  content: string | null;
}

interface AgentRuntimeRecord {
  runId: string;
  taskId: string;
  commandLine: string[];
  sourceWorkingDirectory: string;
  workingDirectory: string;
  stdout: string[];
  stderr: string[];
  exitCode: number | null;
  timedOut: boolean;
  stopRequested: boolean;
  initialSnapshot: Promise<Map<string, SnapshotEntry>>;
  preparedSandboxDir: string;
  preparationMode: 'direct' | 'git_worktree' | 'synthetic_git' | 'snapshot_copy';
  stdoutBuffer: string;
  stderrBuffer: string;
  child?: ChildProcess;
  idleTimedOut: boolean;
  filesystemMode: AgentRunPlan['filesystemMode'];
  networkMode: AgentRunPlan['networkMode'];
  networkDomains: string[];
}

type RuntimeEvent = { type: string; data: Record<string, unknown> };

class AsyncEventQueue implements AsyncIterable<RuntimeEvent> {
  private readonly items: RuntimeEvent[] = [];
  private readonly resolvers: Array<(value: IteratorResult<RuntimeEvent>) => void> = [];
  private isClosed = false;

  push(item: RuntimeEvent): void {
    const resolver = this.resolvers.shift();
    if (resolver) {
      resolver({ value: item, done: false });
      return;
    }

    this.items.push(item);
  }

  close(): void {
    this.isClosed = true;
    while (this.resolvers.length > 0) {
      this.resolvers.shift()?.({ value: undefined as never, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<RuntimeEvent> {
    return {
      next: () => {
        if (this.items.length > 0) {
          return Promise.resolve({ value: this.items.shift() as RuntimeEvent, done: false });
        }

        if (this.isClosed) {
          return Promise.resolve({ value: undefined as never, done: true });
        }

        return new Promise((resolve) => {
          this.resolvers.push(resolve);
        });
      },
    };
  }
}

const SNAPSHOT_IGNORE_DIRS = new Set([
  '.git',
  'node_modules',
  '.next',
  'dist',
  'build',
  'coverage',
  '.turbo',
]);
const MAX_SNAPSHOT_FILE_BYTES = 256 * 1024;
const MAX_PATCH_LINES = 80;

@Injectable()
export class CliAgentRuntimeService {
  private readonly records = new Map<string, AgentRuntimeRecord>();

  async execute(plan: AgentRunPlan, startedMessage: string): Promise<AsyncIterable<RuntimeEvent>> {
    if (!plan.runId) {
      throw new Error('runId is required for CLI execution');
    }

    const queue = new AsyncEventQueue();
    const existingRecord = this.records.get(plan.runId);
    const preparedSandboxDir = plan.sandboxDir || plan.workingDirectory;
    const preparationMode = await this.prepareWorkingDirectory(plan, existingRecord);
    const initialSnapshotData =
      existingRecord?.initialSnapshot
        ? await existingRecord.initialSnapshot
        : preparationMode === 'snapshot_copy' || preparationMode === 'direct'
          ? await this.captureSnapshot(preparedSandboxDir)
          : new Map<string, SnapshotEntry>();
    const initialSnapshot = Promise.resolve(initialSnapshotData);
    const commandLine = [plan.command, ...plan.args];
    const executionEnv = this.buildExecutionEnv(plan);
    const child = spawn(plan.command, plan.args, {
      cwd: preparedSandboxDir,
      env: executionEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const record: AgentRuntimeRecord = {
      runId: plan.runId,
      taskId: plan.taskId,
      commandLine,
      sourceWorkingDirectory: plan.workingDirectory,
      workingDirectory: preparedSandboxDir,
      stdout: existingRecord?.stdout ?? [],
      stderr: existingRecord?.stderr ?? [],
      exitCode: null,
      timedOut: false,
      idleTimedOut: false,
      filesystemMode: plan.filesystemMode,
      networkMode: plan.networkMode,
      networkDomains: plan.networkDomains,
      stopRequested: existingRecord?.stopRequested ?? false,
      initialSnapshot,
      preparedSandboxDir,
      preparationMode,
      stdoutBuffer: '',
      stderrBuffer: '',
      child,
    };
    this.records.set(plan.runId, record);

    const idleTimeoutMs = Math.min(plan.idleTimeoutMs ?? 120_000, plan.timeoutMs);
    const timeout = setTimeout(() => {
      if (record.stopRequested) {
        return;
      }
      record.timedOut = true;
      queue.push({
        type: 'error',
        data: { message: `Agent execution timed out after ${plan.timeoutMs}ms` },
      });
      child.kill('SIGTERM');
    }, plan.timeoutMs);

    let idleTimeout = this.scheduleIdleTimeout(record, queue, child, idleTimeoutMs);
    const refreshIdleTimeout = () => {
      clearTimeout(idleTimeout);
      idleTimeout = this.scheduleIdleTimeout(record, queue, child, idleTimeoutMs);
    };

    queue.push({
      type: 'status',
      data: {
        message: startedMessage,
        command: commandLine.join(' '),
        workingDirectory: preparedSandboxDir,
        preparationMode,
        filesystemMode: plan.filesystemMode,
        allowedPaths: plan.allowedPaths,
        forbiddenPaths: plan.forbiddenPaths,
        networkMode: plan.networkMode,
        networkDomains: plan.networkDomains,
      },
    });

    child.stdout.on('data', (chunk: Buffer | string) => {
      refreshIdleTimeout();
      const text = chunk.toString();
      record.stdout.push(text);
      queue.push({ type: 'stdout', data: { chunk: text } });
      this.processBufferedOutput(record, text, 'stdout', queue);
    });

    child.stderr.on('data', (chunk: Buffer | string) => {
      refreshIdleTimeout();
      const text = chunk.toString();
      record.stderr.push(text);
      queue.push({ type: 'stderr', data: { chunk: text } });
      this.processBufferedOutput(record, text, 'stderr', queue);
    });

    child.on('error', (error) => {
      record.stderr.push(error.message);
      queue.push({ type: 'error', data: { message: error.message } });
    });

    child.on('close', (exitCode) => {
      clearTimeout(timeout);
      clearTimeout(idleTimeout);
      record.exitCode = exitCode;
      record.child = undefined;
      queue.push({
        type: 'status',
        data: {
          message: 'Agent execution finished',
          exitCode,
          timedOut: record.timedOut,
          idleTimedOut: record.idleTimedOut,
          stoppedByUser: record.stopRequested,
          succeeded: !record.timedOut && exitCode === 0,
        },
      });
      queue.close();
    });

    return queue;
  }

  async stop(runId: string): Promise<void> {
    const record = this.records.get(runId);
    if (!record) {
      return;
    }

    record.stopRequested = true;
    record.child?.kill('SIGTERM');
  }

  async cleanup(runId: string): Promise<void> {
    const record = this.records.get(runId);
    if (!record) {
      return;
    }

    record.child?.kill('SIGTERM');
    await this.makeWritable(record.preparedSandboxDir);
    if (record.preparationMode === 'git_worktree') {
      await this.removeGitWorktree(record.sourceWorkingDirectory, record.preparedSandboxDir);
    } else {
      await rm(record.preparedSandboxDir, { recursive: true, force: true });
    }
    this.records.delete(runId);
  }

  async collectDiff(runId: string): Promise<GitDiff> {
    const record = this.records.get(runId);
    if (!record) {
      return this.emptyDiff();
    }

    const isGitRepo = await this.isGitRepository(record.workingDirectory);
    if (isGitRepo) {
      const diffOutput = await this.runGitCommand(record.workingDirectory, [
        'diff',
        '--no-ext-diff',
        '--binary',
        '--find-renames',
        '--no-color',
      ]);
      const statusOutput = await this.runGitCommand(record.workingDirectory, ['status', '--porcelain']);

      const files = this.parseGitDiff(diffOutput.stdout);
      const knownPaths = new Set(files.map((file) => file.path));

      for (const line of statusOutput.stdout.split('\n')) {
        if (!line.trim()) continue;
        const status = line.slice(0, 2);
        const rawPath = line.slice(3).trim();
        const path = rawPath.includes(' -> ') ? rawPath.split(' -> ').at(-1) ?? rawPath : rawPath;
        if (knownPaths.has(path)) continue;

        files.push({
          path,
          status: this.mapGitStatus(status),
          additions: 0,
          deletions: 0,
          patch: '',
        });
      }

      return {
        files,
        summary: {
          additions: files.reduce((sum, file) => sum + file.additions, 0),
          deletions: files.reduce((sum, file) => sum + file.deletions, 0),
          changedFiles: files.length,
        },
      };
    }

    return this.collectSnapshotDiff(record);
  }

  async collectEvidence(runId: string): Promise<AgentEvidence> {
    const record = this.records.get(runId);
    if (!record) {
      throw new Error(`No runtime record found for run ${runId}`);
    }

    const diff = await this.collectDiff(runId);

    return {
      taskId: record.taskId,
      runId,
      commandsRun: [record.commandLine.join(' ')],
      filesChanged: diff.files.map((file) => file.path),
      // Conservative interpretation: if network was allowed for the run, record that capability
      // as used in the execution evidence until syscall-level enforcement exists.
      networkUsed: record.networkMode !== 'disabled',
      secretsAccessed: false,
      succeeded: !record.timedOut && record.exitCode === 0,
      exitCode: record.exitCode,
      timedOut: record.timedOut,
      stoppedByUser: record.stopRequested,
    };
  }

  private scheduleIdleTimeout(
    record: AgentRuntimeRecord,
    queue: AsyncEventQueue,
    child: ChildProcess,
    idleTimeoutMs: number,
  ): NodeJS.Timeout {
    return setTimeout(() => {
      if (record.stopRequested || record.timedOut || record.exitCode !== null) {
        return;
      }

      record.timedOut = true;
      record.idleTimedOut = true;
      queue.push({
        type: 'error',
        data: { message: `Agent execution became idle for ${idleTimeoutMs}ms` },
      });
      child.kill('SIGTERM');
    }, idleTimeoutMs);
  }

  private emptyDiff(): GitDiff {
    return {
      files: [],
      summary: {
        additions: 0,
        deletions: 0,
        changedFiles: 0,
      },
    };
  }

  private buildExecutionEnv(plan: AgentRunPlan): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...plan.env,
      AICP_NETWORK_MODE: plan.networkMode,
      AICP_NETWORK_ALLOWED_DOMAINS: plan.networkDomains.join(','),
    };

    if (plan.networkMode === 'disabled') {
      for (const key of [
        'HTTP_PROXY',
        'HTTPS_PROXY',
        'ALL_PROXY',
        'http_proxy',
        'https_proxy',
        'all_proxy',
        'NO_PROXY',
        'no_proxy',
      ]) {
        delete env[key];
      }

      env.npm_config_offline = 'true';
      env.YARN_ENABLE_OFFLINE_MODE = '1';
      env.PNPM_OFFLINE = 'true';
      env.BUN_INSTALL_OFFLINE = '1';
    }

    return env;
  }

  private processBufferedOutput(
    record: AgentRuntimeRecord,
    chunk: string,
    stream: 'stdout' | 'stderr',
    queue: AsyncEventQueue,
  ): void {
    const bufferKey = stream === 'stdout' ? 'stdoutBuffer' : 'stderrBuffer';
    record[bufferKey] += chunk;
    const parts = record[bufferKey].split('\n');
    record[bufferKey] = parts.pop() ?? '';

    for (const line of parts) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) {
        continue;
      }

      try {
        const payload = JSON.parse(trimmed) as {
          type?: string;
          subtype?: string;
          error?: string;
          message?: string;
          result?: string;
        };
        const event = this.mapStructuredCliEvent(payload);
        if (event) {
          queue.push(event);
        }
      } catch {
        continue;
      }
    }
  }

  private mapStructuredCliEvent(
    payload: {
      type?: string;
      subtype?: string;
      error?: string;
      message?: string;
      result?: string;
      [key: string]: unknown;
    },
  ): RuntimeEvent | null {
    if (payload.type === 'system' && payload.subtype === 'api_retry') {
      return {
        type: 'status',
        data: {
          message: 'Agent API request is retrying',
          error: payload.error ?? 'unknown',
          attempt: payload.attempt ?? null,
          maxRetries: payload.max_retries ?? null,
        },
      };
    }

    if (payload.type === 'result') {
      return {
        type: 'status',
        data: {
          message: 'Agent returned a final result',
          result: payload.result ?? null,
        },
      };
    }

    if (payload.type === 'error') {
      return {
        type: 'error',
        data: {
          message: payload.message ?? payload.error ?? 'Agent reported an error',
        },
      };
    }

    return null;
  }

  private async prepareWorkingDirectory(
    plan: AgentRunPlan,
    existingRecord?: AgentRuntimeRecord,
  ): Promise<AgentRuntimeRecord['preparationMode']> {
    if (plan.sandboxDir === plan.workingDirectory) {
      return 'direct';
    }

    if (existingRecord?.preparedSandboxDir === plan.sandboxDir) {
      return existingRecord.preparationMode;
    }

    const sourceIsGitRepo = await this.isGitRepository(plan.workingDirectory);
    if (sourceIsGitRepo) {
      await this.prepareGitWorktree(plan.workingDirectory, plan.sandboxDir);
      await this.linkWorkspaceNodeModules(plan.workingDirectory, plan.sandboxDir);
      if (plan.filesystemMode === 'read_only') {
        await this.applyReadOnly(plan.sandboxDir);
      } else if (plan.filesystemMode === 'workspace_write') {
        await this.applyWorkspaceWriteRestrictions(
          plan.sandboxDir,
          plan.allowedPaths,
          plan.forbiddenPaths,
        );
      }
      return 'git_worktree';
    }

    await rm(plan.sandboxDir, { recursive: true, force: true });
    await mkdir(plan.sandboxDir, { recursive: true });
    await cp(plan.workingDirectory, plan.sandboxDir, {
      recursive: true,
      filter: (source) => {
        const relativePath = relative(plan.workingDirectory, source);
        if (!relativePath) {
          return true;
        }

        const normalized = relativePath.replaceAll('\\', '/');
        const topLevel = normalized.split('/')[0] ?? '';
        return !SNAPSHOT_IGNORE_DIRS.has(topLevel) && topLevel !== 'node_modules';
      },
    });

    await this.linkWorkspaceNodeModules(plan.workingDirectory, plan.sandboxDir);
    const preparedSyntheticGit = await this.prepareSyntheticGitRepository(plan.sandboxDir);
    if (plan.filesystemMode === 'read_only') {
      await this.applyReadOnly(plan.sandboxDir);
    } else if (plan.filesystemMode === 'workspace_write') {
      await this.applyWorkspaceWriteRestrictions(
        plan.sandboxDir,
        plan.allowedPaths,
        plan.forbiddenPaths,
      );
    }
    return preparedSyntheticGit ? 'synthetic_git' : 'snapshot_copy';
  }

  private async applyReadOnly(root: string): Promise<void> {
    await this.setPermissionsRecursive(root, 0o555, 0o444);
  }

  private async applyWorkspaceWriteRestrictions(
    root: string,
    allowedPaths: string[],
    forbiddenPaths: string[],
  ): Promise<void> {
    if (allowedPaths.length === 0 && forbiddenPaths.length === 0) {
      return;
    }

    await this.applyReadOnly(root);
    const writableDirectoryPrefixes = this.buildWritableDirectoryPrefixes(allowedPaths, forbiddenPaths);
    await this.makePathWritableRecursive(root, root, allowedPaths, forbiddenPaths, writableDirectoryPrefixes);
  }

  private async makeWritable(root: string): Promise<void> {
    await this.setPermissionsRecursive(root, 0o755, 0o644);
  }

  private async setPermissionsRecursive(
    currentPath: string,
    directoryMode: number,
    fileMode: number,
  ): Promise<void> {
    let stats;
    try {
      stats = await lstat(currentPath);
    } catch {
      return;
    }

    if (stats.isSymbolicLink()) {
      return;
    }

    if (stats.isDirectory()) {
      const entries = await readdir(currentPath, { withFileTypes: true }).catch(() => [] as Array<{ name: string }>);

      for (const entry of entries) {
        await this.setPermissionsRecursive(join(currentPath, entry.name), directoryMode, fileMode);
      }

      await chmod(currentPath, directoryMode).catch(() => undefined);
      return;
    }

    if (stats.isFile()) {
      await chmod(currentPath, fileMode).catch(() => undefined);
    }
  }

  private async makePathWritableRecursive(
    root: string,
    currentPath: string,
    allowedPaths: string[],
    forbiddenPaths: string[],
    writableDirectoryPrefixes: Set<string>,
  ): Promise<void> {
    let stats;
    try {
      stats = await lstat(currentPath);
    } catch {
      return;
    }

    if (stats.isSymbolicLink()) {
      return;
    }

    const relativePath = relative(root, currentPath).replaceAll('\\', '/');
    const normalizedRelativePath = relativePath === '' ? '.' : relativePath;

    if (stats.isDirectory()) {
      const shouldMakeWritable =
        normalizedRelativePath === '.' ||
        writableDirectoryPrefixes.has(normalizedRelativePath) ||
        this.isDirectoryDirectlyAllowed(normalizedRelativePath, allowedPaths, forbiddenPaths);

      if (shouldMakeWritable) {
        await chmod(currentPath, 0o755).catch(() => undefined);
      }

      const entries = await readdir(currentPath, { withFileTypes: true }).catch(() => [] as Array<{ name: string }>);
      for (const entry of entries) {
        if (SNAPSHOT_IGNORE_DIRS.has(entry.name) || entry.name === '.git') {
          continue;
        }
        await this.makePathWritableRecursive(
          root,
          join(currentPath, entry.name),
          allowedPaths,
          forbiddenPaths,
          writableDirectoryPrefixes,
        );
      }
      return;
    }

    if (!stats.isFile()) {
      return;
    }

    if (
      matchAnyGlob(allowedPaths, normalizedRelativePath) &&
      !matchAnyGlob(forbiddenPaths, normalizedRelativePath)
    ) {
      await chmod(currentPath, 0o644).catch(() => undefined);
    }
  }

  private isDirectoryDirectlyAllowed(
    relativeDirectory: string,
    allowedPaths: string[],
    forbiddenPaths: string[],
  ): boolean {
    const withGlob = `${relativeDirectory}/**`;
    return (
      matchAnyGlob(allowedPaths, relativeDirectory) ||
      (matchAnyGlob(allowedPaths, withGlob) && !matchAnyGlob(forbiddenPaths, withGlob))
    );
  }

  private buildWritableDirectoryPrefixes(
    allowedPaths: string[],
    forbiddenPaths: string[],
  ): Set<string> {
    const prefixes = new Set<string>(['.']);

    for (const pattern of allowedPaths) {
      const staticPrefix = this.getStaticPathPrefix(pattern);
      if (!staticPrefix) {
        continue;
      }

      const segments = staticPrefix.split('/').filter(Boolean);
      let current = '';
      for (const segment of segments) {
        current = current ? `${current}/${segment}` : segment;
        if (!matchAnyGlob(forbiddenPaths, current) && !matchAnyGlob(forbiddenPaths, `${current}/**`)) {
          prefixes.add(current);
        }
      }
    }

    return prefixes;
  }

  private getStaticPathPrefix(pattern: string): string {
    const normalized = pattern.replaceAll('\\', '/');
    const segments = normalized.split('/');
    const staticSegments: string[] = [];

    for (const segment of segments) {
      if (segment.includes('*') || segment.includes('?')) {
        break;
      }
      staticSegments.push(segment);
    }

    if (staticSegments.length === 0) {
      return '';
    }

    const joined = staticSegments.join('/');
    return normalized.endsWith('/') ? joined : dirname(joined).replaceAll('\\', '/');
  }

  private async linkDirectoryIfPresent(source: string, target: string): Promise<void> {
    try {
      const stats = await lstat(source);
      if (!stats.isDirectory() && !stats.isSymbolicLink()) {
        return;
      }
      await access(target).catch(async () => {
        await symlink(source, target);
      });
    } catch {
      return;
    }
  }

  private async linkWorkspaceNodeModules(sourceRoot: string, sandboxRoot: string): Promise<void> {
    await this.linkNodeModulesRecursive(sourceRoot, sandboxRoot, '');
  }

  private async linkNodeModulesRecursive(
    sourceRoot: string,
    sandboxRoot: string,
    relativeDir: string,
  ): Promise<void> {
    const sourceDir = relativeDir ? join(sourceRoot, relativeDir) : sourceRoot;
    const sandboxDir = relativeDir ? join(sandboxRoot, relativeDir) : sandboxRoot;

    await this.linkDirectoryIfPresent(join(sourceDir, 'node_modules'), join(sandboxDir, 'node_modules'));

    let entries;
    try {
      entries = await readdir(sourceDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      if (SNAPSHOT_IGNORE_DIRS.has(entry.name) || entry.name === 'node_modules' || entry.name === '.git') {
        continue;
      }

      const nextRelativeDir = relativeDir ? join(relativeDir, entry.name) : entry.name;
      await this.linkNodeModulesRecursive(sourceRoot, sandboxRoot, nextRelativeDir);
    }
  }

  private async prepareGitWorktree(sourceRoot: string, sandboxDir: string): Promise<void> {
    await this.removeGitWorktree(sourceRoot, sandboxDir);
    const result = await this.runGitCommand(sourceRoot, ['worktree', 'add', '--detach', '--force', sandboxDir, 'HEAD']);
    if (result.exitCode !== 0) {
      throw new Error(
        `Failed to prepare git worktree at ${sandboxDir}: ${result.stderr || result.stdout || 'unknown git error'}`,
      );
    }
  }

  private async removeGitWorktree(sourceRoot: string, sandboxDir: string): Promise<void> {
    await this.runGitCommand(sourceRoot, ['worktree', 'remove', '--force', sandboxDir]);
    await rm(sandboxDir, { recursive: true, force: true });
  }

  private async prepareSyntheticGitRepository(sandboxDir: string): Promise<boolean> {
    const initResult = await this.runGitCommand(sandboxDir, ['init']);
    if (initResult.exitCode !== 0) {
      return false;
    }

    await this.runGitCommand(sandboxDir, ['config', 'user.name', 'AI Control Plane']);
    await this.runGitCommand(sandboxDir, ['config', 'user.email', 'aicp@example.com']);
    await this.runGitCommand(sandboxDir, ['add', '.']);
    const commitResult = await this.runGitCommand(sandboxDir, ['commit', '-m', 'sandbox baseline']);
    if (commitResult.exitCode !== 0) {
      return false;
    }

    return true;
  }

  private async collectSnapshotDiff(record: AgentRuntimeRecord): Promise<GitDiff> {
    const [before, after] = await Promise.all([
      record.initialSnapshot,
      this.captureSnapshot(record.workingDirectory),
    ]);

    const paths = new Set([...before.keys(), ...after.keys()]);
    const files: DiffFile[] = [];

    for (const path of [...paths].sort()) {
      const previous = before.get(path);
      const next = after.get(path);

      if (!previous && next) {
        files.push(this.buildSnapshotFile(path, 'added', undefined, next));
        continue;
      }
      if (previous && !next) {
        files.push(this.buildSnapshotFile(path, 'deleted', previous, undefined));
        continue;
      }
      if (previous && next && previous.content !== next.content) {
        files.push(this.buildSnapshotFile(path, 'modified', previous, next));
      }
    }

    return {
      files,
      summary: {
        additions: files.reduce((sum, file) => sum + file.additions, 0),
        deletions: files.reduce((sum, file) => sum + file.deletions, 0),
        changedFiles: files.length,
      },
    };
  }

  private buildSnapshotFile(
    path: string,
    status: DiffFile['status'],
    previous?: SnapshotEntry,
    next?: SnapshotEntry,
  ): DiffFile {
    const previousLines = this.toLines(previous?.content);
    const nextLines = this.toLines(next?.content);

    return {
      path,
      status,
      additions: status === 'deleted' ? 0 : nextLines.length,
      deletions: status === 'added' ? 0 : previousLines.length,
      patch: this.buildSimplePatch(path, status, previous?.content, next?.content),
    };
  }

  private buildSimplePatch(
    path: string,
    status: DiffFile['status'],
    previousContent?: string | null,
    nextContent?: string | null,
  ): string {
    if (previousContent === null || nextContent === null) {
      return `diff --snapshot ${path}\nBinary or oversized file changed (${status})`;
    }

    const previousLines = this.toLines(previousContent);
    const nextLines = this.toLines(nextContent);
    const removed = previousLines.slice(0, MAX_PATCH_LINES).map((line) => `-${line}`);
    const added = nextLines.slice(0, MAX_PATCH_LINES).map((line) => `+${line}`);

    return [
      `diff --snapshot ${path}`,
      `--- a/${path}`,
      `+++ b/${path}`,
      ...removed,
      ...added,
    ].join('\n');
  }

  private toLines(content?: string | null): string[] {
    if (!content) {
      return [];
    }

    return content.split('\n');
  }

  private async captureSnapshot(root: string): Promise<Map<string, SnapshotEntry>> {
    const snapshot = new Map<string, SnapshotEntry>();
    await this.captureSnapshotRecursive(root, root, snapshot);
    return snapshot;
  }

  private async captureSnapshotRecursive(
    root: string,
    currentDir: string,
    snapshot: Map<string, SnapshotEntry>,
  ): Promise<void> {
    let entries;
    try {
      entries = await readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (SNAPSHOT_IGNORE_DIRS.has(entry.name)) {
        continue;
      }

      const absolutePath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await this.captureSnapshotRecursive(root, absolutePath, snapshot);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const relativePath = relative(root, absolutePath).replaceAll('\\', '/');
      snapshot.set(relativePath, await this.readSnapshotEntry(absolutePath));
    }
  }

  private async readSnapshotEntry(absolutePath: string): Promise<SnapshotEntry> {
    try {
      const buffer = await readFile(absolutePath);
      if (buffer.byteLength > MAX_SNAPSHOT_FILE_BYTES || buffer.includes(0)) {
        return { content: null };
      }

      return { content: buffer.toString('utf8') };
    } catch {
      return { content: null };
    }
  }

  private async isGitRepository(workingDirectory: string): Promise<boolean> {
    const result = await this.runGitCommand(workingDirectory, ['rev-parse', '--is-inside-work-tree']);
    return result.exitCode === 0 && result.stdout.trim() === 'true';
  }

  private async runGitCommand(
    workingDirectory: string,
    args: string[],
  ): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
    return new Promise((resolve) => {
      const child = spawn('git', ['-C', workingDirectory, ...args], {
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk: Buffer | string) => {
        stdout += chunk.toString();
      });

      child.stderr.on('data', (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });

      child.on('error', (error) => {
        resolve({ stdout, stderr: `${stderr}\n${error.message}`.trim(), exitCode: null });
      });

      child.on('close', (exitCode) => {
        resolve({ stdout, stderr, exitCode });
      });
    });
  }

  private parseGitDiff(diffText: string): DiffFile[] {
    if (!diffText.trim()) {
      return [];
    }

    return diffText
      .split(/^diff --git /m)
      .map((section) => section.trim())
      .filter(Boolean)
      .map((section) => {
        const lines = section.split('\n');
        const header = lines[0] ?? '';
        const pathMatch = header.match(/b\/(.+)$/);
        const path = pathMatch?.[1] ?? header.split(' ').at(-1)?.replace(/^b\//, '') ?? 'unknown';
        const additions = lines.filter((line) => line.startsWith('+') && !line.startsWith('+++')).length;
        const deletions = lines.filter((line) => line.startsWith('-') && !line.startsWith('---')).length;

        let status: DiffFile['status'] = 'modified';
        if (lines.some((line) => line.startsWith('new file mode'))) status = 'added';
        if (lines.some((line) => line.startsWith('deleted file mode'))) status = 'deleted';
        if (lines.some((line) => line.startsWith('rename from '))) status = 'renamed';

        return {
          path,
          status,
          additions,
          deletions,
          patch: `diff --git ${section}`,
        };
      });
  }

  private mapGitStatus(status: string): DiffFile['status'] {
    if (status.includes('R')) return 'renamed';
    if (status.includes('D')) return 'deleted';
    if (status.includes('A') || status.includes('?')) return 'added';
    return 'modified';
  }
}
