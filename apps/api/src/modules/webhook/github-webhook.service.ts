import { Injectable } from '@nestjs/common';
import { ConfigService } from '../../config/configuration.js';
import { createHmac } from 'crypto';

@Injectable()
export class GithubWebhookService {
  constructor(private readonly config: ConfigService) {}

  verifySignature(payload: string, signature: string): boolean {
    const secret = this.config.githubWebhookSecret;
    if (!secret) return true; // Skip verification in dev

    const expected = 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex');
    return expected === signature;
  }

  parseEvent(eventType: string, payload: Record<string, unknown>): {
    eventType: string;
    action: string;
    repoFullName: string;
    payload: Record<string, unknown>;
  } {
    const repo = payload.repository as Record<string, unknown> | undefined;
    const repoFullName = (repo?.full_name as string) ?? '';

    let action = '';
    if (payload.action) {
      action = payload.action as string;
    }

    return {
      eventType,
      action,
      repoFullName,
      payload,
    };
  }
}
