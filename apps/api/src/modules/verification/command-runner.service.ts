import { Injectable } from '@nestjs/common';
import { spawn } from 'node:child_process';

export interface CommandExecutionResult {
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

@Injectable()
export class CommandRunnerService {
  async run(command: string, cwd: string, timeoutMs = 300_000): Promise<CommandExecutionResult> {
    return new Promise((resolve) => {
      const child = spawn('sh', ['-lc', command], {
        cwd,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let settled = false;

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill('SIGTERM');
        resolve({
          success: false,
          exitCode: null,
          stdout,
          stderr: `${stderr}\nCommand timed out after ${timeoutMs}ms`.trim(),
        });
      }, timeoutMs);

      child.stdout.on('data', (chunk: Buffer | string) => {
        stdout += chunk.toString();
      });

      child.stderr.on('data', (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });

      child.on('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve({
          success: false,
          exitCode: null,
          stdout,
          stderr: `${stderr}\n${error.message}`.trim(),
        });
      });

      child.on('close', (exitCode) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve({
          success: exitCode === 0,
          exitCode,
          stdout,
          stderr,
        });
      });
    });
  }
}
