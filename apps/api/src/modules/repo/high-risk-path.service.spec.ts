import { HighRiskPathService } from './high-risk-path.service';

describe('HighRiskPathService', () => {
  let service: HighRiskPathService;

  beforeEach(() => {
    service = new HighRiskPathService();
  });

  describe('auth/** paths are high risk', () => {
    it('identifies auth/login.ts as high risk', () => {
      expect(service.isHighRisk('auth/login.ts')).toBe(true);
    });

    it('identifies auth/middleware/jwt.ts as high risk', () => {
      expect(service.isHighRisk('auth/middleware/jwt.ts')).toBe(true);
    });

    it('identifies auth/ as high risk with nested path', () => {
      expect(service.isHighRisk('auth/')).toBe(true);
    });
  });

  describe('.github/workflows/** paths are high risk', () => {
    it('identifies .github/workflows/ci.yml as high risk', () => {
      expect(service.isHighRisk('.github/workflows/ci.yml')).toBe(true);
    });

    it('identifies .github/workflows/deploy.yml as high risk', () => {
      expect(service.isHighRisk('.github/workflows/deploy.yml')).toBe(true);
    });

    it('does not identify .github/ISSUE_TEMPLATE as high risk', () => {
      expect(service.isHighRisk('.github/ISSUE_TEMPLATE/bug_report.md')).toBe(false);
    });
  });

  describe('migrations/** paths are high risk', () => {
    it('identifies migrations/001_create_users.sql as high risk', () => {
      expect(service.isHighRisk('migrations/001_create_users.sql')).toBe(true);
    });

    it('identifies migrations/2024/add_column.sql as high risk', () => {
      expect(service.isHighRisk('migrations/2024/add_column.sql')).toBe(true);
    });
  });

  describe('CLAUDE.md is high risk', () => {
    it('identifies CLAUDE.md as high risk', () => {
      expect(service.isHighRisk('CLAUDE.md')).toBe(true);
    });

    it('does not identify NOT_CLAUDE.md as high risk', () => {
      expect(service.isHighRisk('NOT_CLAUDE.md')).toBe(false);
    });
  });

  describe('regular src files are not high risk', () => {
    it('does not identify src/utils/helper.ts as high risk', () => {
      expect(service.isHighRisk('src/utils/helper.ts')).toBe(false);
    });

    it('does not identify README.md as high risk', () => {
      expect(service.isHighRisk('README.md')).toBe(false);
    });

    it('does not identify test files as high risk', () => {
      expect(service.isHighRisk('src/modules/auth/auth.service.spec.ts')).toBe(false);
    });

    it('does not identify random paths as high risk', () => {
      expect(service.isHighRisk('docs/api.md')).toBe(false);
    });
  });

  describe('filterHighRisk', () => {
    it('filters out non-high-risk paths', () => {
      const result = service.filterHighRisk([
        'src/utils/helper.ts',
        'auth/login.ts',
        'README.md',
        '.github/workflows/ci.yml',
      ]);

      expect(result).toContain('auth/login.ts');
      expect(result).toContain('.github/workflows/ci.yml');
      expect(result).toHaveLength(2);
    });

    it('returns empty array when no high-risk paths', () => {
      const result = service.filterHighRisk(['src/main.ts', 'docs/api.md']);

      expect(result).toEqual([]);
    });

    it('returns all paths when all are high-risk', () => {
      const result = service.filterHighRisk([
        'auth/login.ts',
        'migrations/001.sql',
        'CLAUDE.md',
      ]);

      expect(result).toHaveLength(3);
    });
  });

  describe('additional high risk patterns', () => {
    it('identifies infra/** paths as high risk', () => {
      expect(service.isHighRisk('infra/main.tf')).toBe(true);
    });

    it('identifies terraform/** paths as high risk', () => {
      expect(service.isHighRisk('terraform/modules/vpc/main.tf')).toBe(true);
    });

    it('identifies k8s/** paths as high risk', () => {
      expect(service.isHighRisk('k8s/deployment.yaml')).toBe(true);
    });

    it('identifies helm/** paths as high risk', () => {
      expect(service.isHighRisk('helm/values.yaml')).toBe(true);
    });

    it('identifies payments/** paths as high risk', () => {
      expect(service.isHighRisk('payments/stripe.service.ts')).toBe(true);
    });

    it('identifies security/** paths as high risk', () => {
      expect(service.isHighRisk('security/policy.yaml')).toBe(true);
    });

    it('identifies secrets/** paths as high risk', () => {
      expect(service.isHighRisk('secrets/vault.json')).toBe(true);
    });

    it('identifies AGENTS.md as high risk', () => {
      expect(service.isHighRisk('AGENTS.md')).toBe(true);
    });

    it('identifies .gitlab-ci.yml as high risk', () => {
      expect(service.isHighRisk('.gitlab-ci.yml')).toBe(true);
    });

    it('identifies Jenkinsfile as high risk', () => {
      expect(service.isHighRisk('Jenkinsfile')).toBe(true);
    });

    it('identifies .codex/** paths as high risk', () => {
      expect(service.isHighRisk('.codex/config.toml')).toBe(true);
    });

    it('identifies .claude/** paths as high risk', () => {
      expect(service.isHighRisk('.claude/settings.json')).toBe(true);
    });

    it('identifies .mcp.json as high risk', () => {
      expect(service.isHighRisk('.mcp.json')).toBe(true);
    });

    it('identifies package.json as high risk', () => {
      expect(service.isHighRisk('package.json')).toBe(true);
    });

    it('identifies pnpm-lock.yaml as high risk', () => {
      expect(service.isHighRisk('pnpm-lock.yaml')).toBe(true);
    });

    it('identifies requirements.txt as high risk', () => {
      expect(service.isHighRisk('requirements.txt')).toBe(true);
    });
  });

  describe('getDefaultHighRiskPaths', () => {
    it('returns the list of high risk path patterns', () => {
      const patterns = service.getDefaultHighRiskPaths();

      expect(patterns.length).toBeGreaterThan(0);
      expect(patterns).toContain('auth/**');
      expect(patterns).toContain('.github/workflows/**');
      expect(patterns).toContain('migrations/**');
      expect(patterns).toContain('CLAUDE.md');
    });

    it('returns a copy that does not affect the internal list', () => {
      const patterns1 = service.getDefaultHighRiskPaths();
      const originalLength = patterns1.length;

      patterns1.push('new-pattern/**');

      const patterns2 = service.getDefaultHighRiskPaths();
      expect(patterns2).toHaveLength(originalLength);
    });
  });
});
