import { Injectable } from '@nestjs/common';

export type DependencyScanFinding = {
  type: 'risky_package' | 'remote_dependency_source' | 'install_script_fetch' | 'shell_bootstrap_script';
  match: string;
};

@Injectable()
export class DependencyScanService {
  private readonly riskyPackagePatterns: Array<{ type: DependencyScanFinding['type']; pattern: RegExp }> = [
    {
      type: 'risky_package',
      pattern:
        /^[+].*"(?:event-stream|flatmap-stream|ua-parser-js|node-ipc|coa|rc|colors)"\s*:\s*"[^"]+"/gim,
    },
    {
      type: 'remote_dependency_source',
      pattern:
        /^[+].*"\w[\w./-]*"\s*:\s*"(?:git\+|github:|https?:\/\/|file:|link:|workspace:|patch:)[^"]+"/gim,
    },
    {
      type: 'install_script_fetch',
      pattern:
        /^[+].*"(?:preinstall|postinstall|prepare)"\s*:\s*"[^"]*\b(?:curl|wget|Invoke-WebRequest)\b[^"]*"/gim,
    },
    {
      type: 'shell_bootstrap_script',
      pattern:
        /^[+].*"(?:preinstall|postinstall|prepare)"\s*:\s*"[^"]*\b(?:curl|wget)\b[^"]*(?:\||&&)[^"]*\b(?:sh|bash|zsh)\b[^"]*"/gim,
    },
  ];

  scan(input: string): { detected: boolean; findings: DependencyScanFinding[] } {
    const findings: DependencyScanFinding[] = [];

    for (const detector of this.riskyPackagePatterns) {
      const matches = input.match(detector.pattern) ?? [];
      for (const match of matches) {
        findings.push({
          type: detector.type,
          match: match.trim(),
        });
      }
    }

    return {
      detected: findings.length > 0,
      findings,
    };
  }
}
