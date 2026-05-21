const INJECTION_PATTERNS: readonly RegExp[] = [
  /ignore\s+(all\s+)?previous\s+(instructions?|rules?|guidelines?)/i,
  /disregard\s+(all\s+)?previous/i,
  /forget\s+(all\s+)?previous/i,
  /exfiltrate\s+secrets/i,
  /print\s+(all\s+)?environment\s+variables/i,
  /print\s+(all\s+)?api\s+keys/i,
  /disable\s+ci/i,
  /delete\s+(the\s+)?failing\s+tests?/i,
  /delete\s+(the\s+)?tests?\s+to\s+pass/i,
  /change\s+policy\s+to\s+allow/i,
  /curl\s+this\s+payload/i,
  /run\s+this\s+script\s+and\s+paste\s+output/i,
  /export\s+(all\s+)?(env|secrets?|tokens?)/i,
  /bypass\s+(the\s+)?(review|approval|policy|security)/i,
  /ignore\s+(the\s+)?CLAUDE\.md/i,
  /ignore\s+(the\s+)?AGENTS\.md/i,
];

export interface InjectionDetectionResult {
  detected: boolean;
  matchedPatterns: string[];
}

export function detectPromptInjection(input: string): InjectionDetectionResult {
  const matchedPatterns: string[] = [];

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(input)) {
      matchedPatterns.push(pattern.source);
    }
  }

  return {
    detected: matchedPatterns.length > 0,
    matchedPatterns,
  };
}
