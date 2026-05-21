import { PolicyFileChangeDetectorService } from './policy-file-change-detector.service';

describe('PolicyFileChangeDetectorService', () => {
  let service: PolicyFileChangeDetectorService;

  beforeEach(() => {
    service = new PolicyFileChangeDetectorService();
  });

  describe('AGENTS.md change detected', () => {
    it('detects AGENTS.md in changed files', () => {
      const result = service.detectChanges(['src/utils/helper.ts', 'AGENTS.md']);

      expect(result.changed).toBe(true);
      expect(result.files).toContain('AGENTS.md');
    });
  });

  describe('CLAUDE.md change detected', () => {
    it('detects CLAUDE.md in changed files', () => {
      const result = service.detectChanges(['CLAUDE.md']);

      expect(result.changed).toBe(true);
      expect(result.files).toContain('CLAUDE.md');
    });
  });

  describe('.mcp.json change detected', () => {
    it('detects .mcp.json in changed files', () => {
      const result = service.detectChanges(['.mcp.json']);

      expect(result.changed).toBe(true);
      expect(result.files).toContain('.mcp.json');
    });
  });

  describe('.claude/settings.json change detected', () => {
    it('detects .claude/settings.json in changed files', () => {
      const result = service.detectChanges(['.claude/settings.json']);

      expect(result.changed).toBe(true);
      expect(result.files).toContain('.claude/settings.json');
    });

    it('detects .claude/settings.local.json in changed files', () => {
      const result = service.detectChanges(['.claude/settings.local.json']);

      expect(result.changed).toBe(true);
      expect(result.files).toContain('.claude/settings.local.json');
    });
  });

  describe('regular source file not flagged', () => {
    it('does not flag regular source files', () => {
      const result = service.detectChanges(['src/modules/auth/auth.service.ts']);

      expect(result.changed).toBe(false);
      expect(result.files).toEqual([]);
    });

    it('does not flag test files', () => {
      const result = service.detectChanges(['src/modules/auth/auth.service.spec.ts']);

      expect(result.changed).toBe(false);
      expect(result.files).toEqual([]);
    });

    it('does not flag config files that are not policy files', () => {
      const result = service.detectChanges(['tsconfig.json', '.eslintrc.js']);

      expect(result.changed).toBe(false);
      expect(result.files).toEqual([]);
    });

    it('does not flag empty file list', () => {
      const result = service.detectChanges([]);

      expect(result.changed).toBe(false);
      expect(result.files).toEqual([]);
    });
  });

  describe('risk level is high when policy files changed', () => {
    it('returns high risk level when policy files are changed', () => {
      const result = service.detectChanges(['AGENTS.md', 'CLAUDE.md']);

      expect(result.riskLevel).toBe('high');
    });

    it('returns low risk level when no policy files are changed', () => {
      const result = service.detectChanges(['src/index.ts']);

      expect(result.riskLevel).toBe('low');
    });
  });

  describe('isPolicyFile', () => {
    it('identifies AGENTS.md as a policy file', () => {
      expect(service.isPolicyFile('AGENTS.md')).toBe(true);
    });

    it('identifies AGENTS.override.md as a policy file', () => {
      expect(service.isPolicyFile('AGENTS.override.md')).toBe(true);
    });

    it('identifies CLAUDE.md as a policy file', () => {
      expect(service.isPolicyFile('CLAUDE.md')).toBe(true);
    });

    it('identifies CLAUDE.local.md as a policy file', () => {
      expect(service.isPolicyFile('CLAUDE.local.md')).toBe(true);
    });

    it('identifies .codex/config.toml as a policy file', () => {
      expect(service.isPolicyFile('.codex/config.toml')).toBe(true);
    });

    it('identifies .codex/hooks.json as a policy file', () => {
      expect(service.isPolicyFile('.codex/hooks.json')).toBe(true);
    });

    it('identifies .mcp.json as a policy file', () => {
      expect(service.isPolicyFile('.mcp.json')).toBe(true);
    });

    it('does not identify regular files as policy files', () => {
      expect(service.isPolicyFile('src/main.ts')).toBe(false);
    });

    it('matches policy file at nested path', () => {
      expect(service.isPolicyFile('project/AGENTS.md')).toBe(true);
    });

    it('matches policy file at deeply nested path', () => {
      expect(service.isPolicyFile('apps/api/CLAUDE.md')).toBe(true);
    });
  });

  describe('detects all policy file types', () => {
    it('detects multiple policy files changed at once', () => {
      const result = service.detectChanges([
        'AGENTS.md',
        'CLAUDE.md',
        '.mcp.json',
        '.claude/settings.json',
      ]);

      expect(result.changed).toBe(true);
      expect(result.files).toHaveLength(4);
      expect(result.riskLevel).toBe('high');
    });

    it('detects policy files mixed with regular files', () => {
      const result = service.detectChanges([
        'src/utils/helper.ts',
        'AGENTS.md',
        'src/modules/auth/auth.service.ts',
      ]);

      expect(result.changed).toBe(true);
      expect(result.files).toEqual(['AGENTS.md']);
      expect(result.riskLevel).toBe('high');
    });
  });
});
