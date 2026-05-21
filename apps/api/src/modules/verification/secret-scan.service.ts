import { Injectable } from '@nestjs/common';

export type SecretScanFinding = {
  type: 'aws_access_key' | 'github_token' | 'npm_token' | 'slack_token' | 'private_key' | 'generic_api_key';
  match: string;
};

@Injectable()
export class SecretScanService {
  private readonly detectors: Array<{ type: SecretScanFinding['type']; pattern: RegExp }> = [
    { type: 'aws_access_key', pattern: /\bAKIA[0-9A-Z]{16}\b/g },
    { type: 'github_token', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g },
    { type: 'npm_token', pattern: /\bnpm_[A-Za-z0-9]{36}\b/g },
    { type: 'slack_token', pattern: /\bxox(?:a|b|p|r|s)-[A-Za-z0-9-]{10,}\b/g },
    { type: 'private_key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
    { type: 'generic_api_key', pattern: /\b(?:api[_-]?key|secret|token)\s*[:=]\s*['"][A-Za-z0-9_\-]{16,}['"]/gi },
  ];

  scan(input: string): { detected: boolean; findings: SecretScanFinding[] } {
    const findings: SecretScanFinding[] = [];

    for (const detector of this.detectors) {
      const matches = input.match(detector.pattern) ?? [];
      for (const match of matches) {
        findings.push({ type: detector.type, match });
      }
    }

    return {
      detected: findings.length > 0,
      findings,
    };
  }
}
