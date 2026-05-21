import { Injectable } from '@nestjs/common';

export type LicenseScanFinding = {
  type: 'copyleft_license' | 'restricted_license' | 'custom_license_reference' | 'license_array_reference';
  match: string;
};

@Injectable()
export class LicenseScanService {
  private readonly detectors: Array<{ type: LicenseScanFinding['type']; pattern: RegExp }> = [
    {
      type: 'copyleft_license',
      pattern:
        /^[+].*"(?:license|licenses)"\s*:\s*"(?:GPL|AGPL|LGPL|MPL|EUPL)[^"]*"/gim,
    },
    {
      type: 'restricted_license',
      pattern:
        /^[+].*"(?:license|licenses)"\s*:\s*"(?:BUSL|SSPL|Commons Clause|Elastic License|PolyForm)[^"]*"/gim,
    },
    {
      type: 'custom_license_reference',
      pattern:
        /^[+].*"(?:license|licenses)"\s*:\s*"(?:SEE LICENSE IN|UNLICENSED|LicenseRef-[^"]+)"/gim,
    },
    {
      type: 'license_array_reference',
      pattern:
        /^[+].*"licenses"\s*:\s*\[[^\]]*(?:GPL|AGPL|LGPL|BUSL|SSPL|Commons Clause|Elastic License|LicenseRef-|SEE LICENSE IN|UNLICENSED)[^\]]*\]/gim,
    },
  ];

  scan(input: string): { detected: boolean; findings: LicenseScanFinding[] } {
    const findings: LicenseScanFinding[] = [];

    for (const detector of this.detectors) {
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
