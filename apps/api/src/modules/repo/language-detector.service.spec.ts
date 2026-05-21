import { LanguageDetectorService } from './language-detector.service';

describe('LanguageDetectorService', () => {
  let service: LanguageDetectorService;

  beforeEach(() => {
    service = new LanguageDetectorService();
  });

  describe('file-based detection', () => {
    it('detects package managers and commands from known manifests', () => {
      expect(service.detectFromFiles(['go.mod'])).toEqual(
        expect.objectContaining({
          languages: ['go'],
          packageManager: 'go modules',
          testCommand: 'go test ./...',
          buildCommand: 'go build ./...',
        }),
      );

      expect(service.detectFromFiles(['Cargo.toml'])).toEqual(
        expect.objectContaining({
          languages: ['rust'],
          packageManager: 'cargo',
          testCommand: 'cargo test',
          buildCommand: 'cargo build',
        }),
      );

      expect(service.detectFromFiles(['uv.lock'])).toEqual(
        expect.objectContaining({
          languages: ['python'],
          packageManager: 'uv',
          testCommand: 'uv run pytest',
          lintCommand: 'uv run ruff check .',
          buildCommand: 'uv build',
        }),
      );
    });

    it('adds typescript when tsconfig.json is present', () => {
      const result = service.detectFromFiles(['package.json', 'tsconfig.json']);

      expect(result.languages).toContain('typescript');
      expect(result.languages.filter((language) => language === 'typescript')).toHaveLength(1);
    });

    it('returns empty languages for unrecognized files', () => {
      const result = service.detectFromFiles(['Makefile', 'Dockerfile']);

      expect(result.languages).toEqual([]);
    });
  });

  describe('package.json parsing', () => {
    it('prefers packageManager field and only keeps scripts that actually exist', () => {
      const result = service.detectFromProject(['package.json'], {
        'package.json': JSON.stringify({
          packageManager: 'pnpm@9.0.0',
          scripts: {
            test: 'vitest run',
            lint: 'eslint .',
            build: 'turbo build',
          },
          devDependencies: {
            typescript: '^5.0.0',
          },
        }),
      });

      expect(result.languages).toContain('typescript');
      expect(result.packageManager).toBe('pnpm');
      expect(result.testCommand).toBe('pnpm test');
      expect(result.lintCommand).toBe('pnpm lint');
      expect(result.buildCommand).toBe('pnpm build');
      expect(result.typecheckCommand).toBeUndefined();
    });

    it('supports bun projects', () => {
      const result = service.detectFromProject(['package.json', 'bun.lockb'], {
        'package.json': JSON.stringify({
          packageManager: 'bun@1.1.0',
          scripts: {
            test: 'vitest',
            typecheck: 'tsc --noEmit',
          },
        }),
      });

      expect(result.packageManager).toBe('bun');
      expect(result.testCommand).toBe('bun test');
      expect(result.typecheckCommand).toBe('bun run typecheck');
      expect(result.lintCommand).toBeUndefined();
    });
  });

  describe('pyproject.toml parsing', () => {
    it('detects poetry projects from pyproject contents', () => {
      const result = service.detectFromProject(['pyproject.toml'], {
        'pyproject.toml': `
[tool.poetry]
name = "demo"
version = "0.1.0"
`,
      });

      expect(result.languages).toContain('python');
      expect(result.packageManager).toBe('poetry');
      expect(result.testCommand).toBe('poetry run pytest');
      expect(result.lintCommand).toBe('poetry run ruff check .');
      expect(result.buildCommand).toBe('poetry build');
    });
  });

  describe('detectDefault', () => {
    it('returns unknown as default language', () => {
      const result = service.detectDefault();

      expect(result.languages).toEqual(['unknown']);
    });
  });
});
