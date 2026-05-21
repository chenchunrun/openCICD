import { Injectable } from '@nestjs/common';

export interface TestWeakeningResult {
  detected: boolean;
  issues: string[];
}

@Injectable()
export class TestWeakeningDetectorService {
  detect(diff: string): TestWeakeningResult {
    const issues: string[] = [];

    if (/^-.*\b(it|test|describe)\s*\(/m.test(diff)) {
      issues.push('Test function deleted');
    }

    if (
      /^-.*\bexpect\s*\(/m.test(diff) ||
      /^-.*\bassert(?:\.[A-Za-z_][A-Za-z0-9_]*)?\s*\(/m.test(diff) ||
      /^-.*\.[Ss]hould\b/m.test(diff)
    ) {
      issues.push('Assertion removed or weakened');
    }

    if (/^\+.*\b(skip|xit|xdescribe|todo|pending|xfail)\s*\(/m.test(diff)) {
      issues.push('Test skip/xfail added');
    }

    if (/^\+.*\b(tests?\s*=\s*false|runTests\s*=\s*false)/m.test(diff)) {
      issues.push('Tests disabled in configuration');
    }

    if (/^-.*\b(throw|Error|reject)/m.test(diff) && /^\+.*\.toBe\(null\)|\.toBe\(undefined\)/m.test(diff)) {
      issues.push('Error expectation replaced with null/undefined check');
    }

    return {
      detected: issues.length > 0,
      issues,
    };
  }
}
