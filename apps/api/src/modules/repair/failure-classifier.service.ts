import { Injectable } from '@nestjs/common';
import type { FailureClassification } from '@aicp/shared';

const CLASSIFICATION_RULES: Array<{ pattern: RegExp; type: FailureClassification }> = [
  { pattern: /sast|security|vulnerability|cve/i, type: 'security_scan_failure' },
  { pattern: /policy|denied|forbidden|not allowed/i, type: 'policy_violation' },
  { pattern: /eslint|\blint\b/i, type: 'lint_failure' },
  { pattern: /prettier|format(ting)?|indent/i, type: 'formatting_failure' },
  { pattern: /type\s*error|ts\(.*\)|cannot find name/i, type: 'type_error' },
  { pattern: /integration.*fail|e2e.*fail/i, type: 'integration_failure' },
  { pattern: /flaky|timeout|intermittent/i, type: 'flaky_test' },
  { pattern: /migration|schema|alter table/i, type: 'migration_failure' },
  { pattern: /terraform|kubernetes|infrastructure/i, type: 'infrastructure_plan_failure' },
  { pattern: /npm install|pip install|dependency|module not found/i, type: 'dependency_install_failure' },
  { pattern: /test\s+failed|assertion|expect\(.*\)\.to/i, type: 'unit_test_failure' },
];

@Injectable()
export class FailureClassifierService {
  classify(log: string): FailureClassification {
    for (const rule of CLASSIFICATION_RULES) {
      if (rule.pattern.test(log)) {
        return rule.type;
      }
    }
    return 'unit_test_failure';
  }
}
