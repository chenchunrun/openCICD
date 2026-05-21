export function matchGlob(pattern: string, path: string): boolean {
  const regex = globToRegex(pattern);
  return regex.test(path);
}

export function matchAnyGlob(patterns: readonly string[], path: string): boolean {
  return patterns.some((p) => matchGlob(p, path));
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '{{DOUBLESTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/{{DOUBLESTAR}}/g, '.*')
    .replace(/\?/g, '[^/]');

  return new RegExp(`^${escaped}$`);
}
