import { Injectable } from '@nestjs/common';

export type SastFinding = {
  type:
    | 'eval_usage'
    | 'function_constructor'
    | 'child_process_exec'
    | 'child_process_exec_file'
    | 'shell_injection_pattern'
    | 'dangerously_set_inner_html'
    | 'sql_string_concatenation'
    | 'sql_template_interpolation';
  match: string;
};

@Injectable()
export class SastScanService {
  private readonly detectors: Array<{ type: SastFinding['type']; pattern: RegExp }> = [
    { type: 'eval_usage', pattern: /\beval\s*\(/g },
    { type: 'function_constructor', pattern: /\bnew\s+Function\s*\(/g },
    { type: 'child_process_exec', pattern: /\bexec(?:Sync)?\s*\(/g },
    { type: 'child_process_exec_file', pattern: /\bexecFile(?:Sync)?\s*\(/g },
    { type: 'shell_injection_pattern', pattern: /\bspawn(?:Sync)?\s*\([^)]*shell\s*:\s*true/gs },
    { type: 'dangerously_set_inner_html', pattern: /dangerouslySetInnerHTML/g },
    {
      type: 'sql_string_concatenation',
      pattern: /\b(?:SELECT|INSERT|UPDATE|DELETE)\b[\s\S]{0,120}\+\s*[A-Za-z_$][\w$]*/gi,
    },
    {
      type: 'sql_template_interpolation',
      pattern: /\b(?:SELECT|INSERT|UPDATE|DELETE)\b[\s\S]{0,120}\$\{[^}]+\}/gi,
    },
  ];

  scan(input: string): { detected: boolean; findings: SastFinding[] } {
    const findings: SastFinding[] = [];

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
