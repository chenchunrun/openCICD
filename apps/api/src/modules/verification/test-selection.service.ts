import { Injectable } from '@nestjs/common';
import { matchGlob } from '@aicp/shared';

@Injectable()
export class TestSelectionService {
  private readonly pathTestRules: Array<{ whenChanged: string[]; requiredChecks: string[] }> = [
    {
      whenChanged: ['auth/**'],
      requiredChecks: ['auth-unit', 'auth-integration', 'security-sast', 'token-contract'],
    },
    {
      whenChanged: ['migrations/**'],
      requiredChecks: ['migration-dry-run', 'rollback-plan-check'],
    },
    {
      whenChanged: ['infra/**', 'terraform/**', 'k8s/**'],
      requiredChecks: ['terraform-plan', 'opa-policy'],
    },
    {
      whenChanged: ['payments/**'],
      requiredChecks: ['payment-unit', 'payment-integration', 'security-sast'],
    },
  ];

  selectTests(changedFiles: string[]): string[] {
    const checks = new Set<string>();

    for (const rule of this.pathTestRules) {
      const matches = changedFiles.some((file) =>
        rule.whenChanged.some((pattern) => matchGlob(pattern, file)),
      );
      if (matches) {
        for (const check of rule.requiredChecks) {
          checks.add(check);
        }
      }
    }

    return [...checks];
  }
}
