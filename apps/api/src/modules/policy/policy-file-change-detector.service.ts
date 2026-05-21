import { Injectable } from '@nestjs/common';
import { AGENT_POLICY_FILES } from '@aicp/shared';
import type { RiskLevel } from '@aicp/shared';

export interface PolicyFileChangeResult {
  changed: boolean;
  files: string[];
  riskLevel: RiskLevel;
}

@Injectable()
export class PolicyFileChangeDetectorService {
  private readonly policyFilePatterns = [...AGENT_POLICY_FILES];

  detectChanges(changedFiles: string[]): PolicyFileChangeResult {
    const matched = changedFiles.filter((file) => this.isPolicyFile(file));

    return {
      changed: matched.length > 0,
      files: matched,
      riskLevel: matched.length > 0 ? 'high' : 'low',
    };
  }

  isPolicyFile(filePath: string): boolean {
    return this.policyFilePatterns.some((pattern) => {
      if (pattern.includes('*')) {
        return this.matchSimpleGlob(pattern, filePath);
      }
      return filePath === pattern || filePath.endsWith('/' + pattern);
    });
  }

  private matchSimpleGlob(pattern: string, path: string): boolean {
    const normalized = pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*');
    return new RegExp(`^${normalized}$`).test(path);
  }
}
