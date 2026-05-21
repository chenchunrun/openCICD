import { Injectable } from '@nestjs/common';

@Injectable()
export class ConfigService {
  get databaseUrl(): string {
    return process.env.DATABASE_URL ?? 'postgresql://aicp:aicp_dev@localhost:5432/aicp';
  }

  get redisUrl(): string {
    return process.env.REDIS_URL ?? 'redis://localhost:6379';
  }

  get githubWebhookSecret(): string {
    return process.env.GITHUB_WEBHOOK_SECRET ?? '';
  }

  get githubToken(): string {
    return process.env.GITHUB_TOKEN ?? '';
  }

  get githubApiUrl(): string {
    return process.env.GITHUB_API_URL ?? 'https://api.github.com';
  }

  get claudeCodePath(): string {
    return process.env.CLAUDE_CODE_PATH ?? 'claude';
  }

  get codexPath(): string {
    return process.env.CODEX_PATH ?? 'codex';
  }

  get workspaceDir(): string {
    return process.env.AICP_WORKSPACE_DIR ?? process.cwd();
  }

  get apiPort(): number {
    return parseInt(process.env.API_PORT ?? '3001', 10);
  }

  get nodeEnv(): string {
    return process.env.NODE_ENV ?? 'development';
  }
}
