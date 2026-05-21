import { TestSelectionService } from './test-selection.service';

describe('TestSelectionService', () => {
  let service: TestSelectionService;

  beforeEach(() => {
    service = new TestSelectionService();
  });

  describe('auth files trigger auth checks', () => {
    it('returns auth checks when a file in auth/ changes', () => {
      const result = service.selectTests(['auth/login.ts']);

      expect(result).toContain('auth-unit');
      expect(result).toContain('auth-integration');
      expect(result).toContain('security-sast');
      expect(result).toContain('token-contract');
    });

    it('returns auth checks when a nested file in auth/ changes', () => {
      const result = service.selectTests(['auth/middleware/jwt.ts']);

      expect(result).toContain('auth-unit');
      expect(result).toContain('auth-integration');
    });
  });

  describe('migration files trigger migration checks', () => {
    it('returns migration checks when a file in migrations/ changes', () => {
      const result = service.selectTests(['migrations/001_create_users.sql']);

      expect(result).toContain('migration-dry-run');
      expect(result).toContain('rollback-plan-check');
    });

    it('returns migration checks for nested migration files', () => {
      const result = service.selectTests(['migrations/2024/add_column.sql']);

      expect(result).toContain('migration-dry-run');
      expect(result).toContain('rollback-plan-check');
    });
  });

  describe('infra files trigger infra checks', () => {
    it('returns infra checks when a file in infra/ changes', () => {
      const result = service.selectTests(['infra/main.tf']);

      expect(result).toContain('terraform-plan');
      expect(result).toContain('opa-policy');
    });

    it('returns infra checks when a file in terraform/ changes', () => {
      const result = service.selectTests(['terraform/modules/vpc/main.tf']);

      expect(result).toContain('terraform-plan');
      expect(result).toContain('opa-policy');
    });

    it('returns infra checks when a file in k8s/ changes', () => {
      const result = service.selectTests(['k8s/deployment.yaml']);

      expect(result).toContain('terraform-plan');
      expect(result).toContain('opa-policy');
    });
  });

  describe('payment files trigger payment checks', () => {
    it('returns payment checks when a file in payments/ changes', () => {
      const result = service.selectTests(['payments/stripe.service.ts']);

      expect(result).toContain('payment-unit');
      expect(result).toContain('payment-integration');
      expect(result).toContain('security-sast');
    });

    it('returns payment checks for nested payment files', () => {
      const result = service.selectTests(['payments/refunds/handler.ts']);

      expect(result).toContain('payment-unit');
      expect(result).toContain('payment-integration');
      expect(result).toContain('security-sast');
    });
  });

  describe('non-matching files get no specific checks', () => {
    it('returns empty array when no matching rules', () => {
      const result = service.selectTests(['src/utils/helper.ts']);

      expect(result).toEqual([]);
    });

    it('returns empty array for unrelated config files', () => {
      const result = service.selectTests(['README.md', '.gitignore']);

      expect(result).toEqual([]);
    });

    it('returns empty array for empty input', () => {
      const result = service.selectTests([]);

      expect(result).toEqual([]);
    });
  });

  describe('multiple file changes combine checks', () => {
    it('deduplicates checks when multiple rules produce overlapping results', () => {
      const result = service.selectTests(['auth/jwt.ts', 'payments/handler.ts']);

      // security-sast appears in both auth and payment rules
      const sastCount = result.filter((c) => c === 'security-sast').length;
      expect(sastCount).toBe(1);

      expect(result).toContain('auth-unit');
      expect(result).toContain('payment-unit');
    });

    it('combines checks from auth and infra changes', () => {
      const result = service.selectTests(['auth/login.ts', 'infra/main.tf']);

      expect(result).toContain('auth-unit');
      expect(result).toContain('auth-integration');
      expect(result).toContain('terraform-plan');
      expect(result).toContain('opa-policy');
    });
  });
});
