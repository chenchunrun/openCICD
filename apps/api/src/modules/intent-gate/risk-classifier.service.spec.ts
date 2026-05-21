import { RiskClassifierService } from './risk-classifier.service';

describe('RiskClassifierService', () => {
  let service: RiskClassifierService;

  beforeEach(() => {
    service = new RiskClassifierService();
  });

  const defaultScope = { allowedPaths: ['src/utils/**'], forbiddenPaths: [] };
  const defaultConstraints: string[] = [];

  describe('docs/formatting tasks classified as low', () => {
    it('classifies goal with "docs" as low', () => {
      const result = service.classify('Update docs for the API', defaultScope, defaultConstraints);

      expect(result.level).toBe('low');
      expect(result.reasons).toContain('documentation_or_formatting');
    });

    it('classifies goal with "formatting" as low', () => {
      const result = service.classify('Fix formatting in the codebase', defaultScope, defaultConstraints);

      expect(result.level).toBe('low');
      expect(result.reasons).toContain('documentation_or_formatting');
    });

    it('classifies goal with "typo" as low', () => {
      const result = service.classify('Fix typo in README', defaultScope, defaultConstraints);

      expect(result.level).toBe('low');
      expect(result.reasons).toContain('documentation_or_formatting');
    });

    it('classifies goal with "Docs" (uppercase) as low', () => {
      const result = service.classify('Docs update', defaultScope, defaultConstraints);

      expect(result.level).toBe('low');
      expect(result.reasons).toContain('documentation_or_formatting');
    });
  });

  describe('standard business logic classified as medium', () => {
    it('classifies a regular feature task as medium', () => {
      const result = service.classify('Add user profile page', defaultScope, defaultConstraints);

      expect(result.level).toBe('medium');
      expect(result.reasons).toContain('standard_business_logic');
    });

    it('classifies a refactoring task as medium', () => {
      const result = service.classify('Refactor the utility module', defaultScope, defaultConstraints);

      expect(result.level).toBe('medium');
      expect(result.reasons).toContain('standard_business_logic');
    });
  });

  describe('auth-related goal classified as high', () => {
    it('classifies goal with "auth" as high', () => {
      const result = service.classify('Update auth logic', defaultScope, defaultConstraints);

      expect(result.level).toBe('high');
      expect(result.reasons).toContain('touches_auth_logic');
    });

    it('classifies goal with "login" as high', () => {
      const result = service.classify('Fix login flow', defaultScope, defaultConstraints);

      expect(result.level).toBe('high');
      expect(result.reasons).toContain('touches_auth_logic');
    });

    it('classifies goal with "token" as high', () => {
      const result = service.classify('Refresh token handling', defaultScope, defaultConstraints);

      expect(result.level).toBe('high');
      expect(result.reasons).toContain('touches_auth_logic');
    });

    it('classifies goal with "session" as high', () => {
      const result = service.classify('Session management update', defaultScope, defaultConstraints);

      expect(result.level).toBe('high');
      expect(result.reasons).toContain('touches_auth_logic');
    });

    it('classifies paths containing "auth" as high', () => {
      const result = service.classify(
        'Update logic',
        { allowedPaths: ['src/auth/handler.ts'], forbiddenPaths: [] },
        defaultConstraints,
      );

      expect(result.level).toBe('high');
      expect(result.reasons).toContain('touches_auth_logic');
    });
  });

  describe('payment-related goal classified as high', () => {
    it('classifies goal with "payment" as high', () => {
      const result = service.classify('Process payment refund', defaultScope, defaultConstraints);

      expect(result.level).toBe('high');
      expect(result.reasons).toContain('touches_payments');
    });

    it('classifies goal with "billing" as high', () => {
      const result = service.classify('Fix billing cycle calculation', defaultScope, defaultConstraints);

      expect(result.level).toBe('high');
      expect(result.reasons).toContain('touches_payments');
    });

    it('classifies goal with "charge" as high', () => {
      const result = service.classify('Update charge model', defaultScope, defaultConstraints);

      expect(result.level).toBe('high');
      expect(result.reasons).toContain('touches_payments');
    });

    it('classifies paths containing "payment" as high', () => {
      const result = service.classify(
        'Update logic',
        { allowedPaths: ['src/payments/stripe.ts'], forbiddenPaths: [] },
        defaultConstraints,
      );

      expect(result.level).toBe('high');
      expect(result.reasons).toContain('touches_payments');
    });
  });

  describe('infra-related goal classified as high', () => {
    it('classifies goal with "terraform" as high', () => {
      const result = service.classify('Update terraform configuration', defaultScope, defaultConstraints);

      expect(result.level).toBe('high');
      expect(result.reasons).toContain('touches_infrastructure');
    });

    it('classifies goal with "kubernetes" as high', () => {
      const result = service.classify('Scale kubernetes pods', defaultScope, defaultConstraints);

      expect(result.level).toBe('high');
      expect(result.reasons).toContain('touches_infrastructure');
    });

    it('classifies goal with "deploy" as high', () => {
      const result = service.classify('Deploy the staging environment', defaultScope, defaultConstraints);

      expect(result.level).toBe('high');
      expect(result.reasons).toContain('touches_infrastructure');
    });

    it('classifies paths containing "infra" as high', () => {
      const result = service.classify(
        'Update configuration',
        { allowedPaths: ['infra/main.tf'], forbiddenPaths: [] },
        defaultConstraints,
      );

      expect(result.level).toBe('high');
      expect(result.reasons).toContain('touches_infrastructure');
    });

    it('classifies paths containing "terraform" as high', () => {
      const result = service.classify(
        'Update configuration',
        { allowedPaths: ['terraform/modules/**'], forbiddenPaths: [] },
        defaultConstraints,
      );

      expect(result.level).toBe('high');
      expect(result.reasons).toContain('touches_infrastructure');
    });

    it('classifies paths containing "k8s" as high', () => {
      const result = service.classify(
        'Update configuration',
        { allowedPaths: ['k8s/deployment.yaml'], forbiddenPaths: [] },
        defaultConstraints,
      );

      expect(result.level).toBe('high');
      expect(result.reasons).toContain('touches_infrastructure');
    });
  });

  describe('migration-related goal classified as high', () => {
    it('classifies goal with "migration" as high', () => {
      const result = service.classify('Add migration for users table', defaultScope, defaultConstraints);

      expect(result.level).toBe('high');
      expect(result.reasons).toContain('touches_migrations');
    });

    it('classifies goal with "schema" as high', () => {
      const result = service.classify('Update schema definitions', defaultScope, defaultConstraints);

      expect(result.level).toBe('high');
      expect(result.reasons).toContain('touches_migrations');
    });

    it('classifies paths containing "migration" as high', () => {
      const result = service.classify(
        'Update data',
        { allowedPaths: ['migrations/001_create_users.sql'], forbiddenPaths: [] },
        defaultConstraints,
      );

      expect(result.level).toBe('high');
      expect(result.reasons).toContain('touches_migrations');
    });
  });

  describe('secrets-related goal classified as critical', () => {
    it('classifies goal with "secret" as critical', () => {
      const result = service.classify('Rotate secret keys', defaultScope, defaultConstraints);

      expect(result.level).toBe('critical');
      expect(result.reasons).toContain('involves_secrets');
    });

    it('classifies goal with "credential" as critical', () => {
      const result = service.classify('Update credential provider', defaultScope, defaultConstraints);

      expect(result.level).toBe('critical');
      expect(result.reasons).toContain('involves_secrets');
    });

    it('classifies goal with "api key" as critical', () => {
      const result = service.classify('Regenerate api key', defaultScope, defaultConstraints);

      expect(result.level).toBe('critical');
      expect(result.reasons).toContain('involves_secrets');
    });

    it('classifies constraint with "secret" as critical', () => {
      const result = service.classify(
        'Update configuration',
        defaultScope,
        ['Must handle secret rotation'],
      );

      expect(result.level).toBe('critical');
      expect(result.reasons).toContain('involves_secrets');
    });
  });

  describe('production-related goal classified as critical', () => {
    it('classifies goal with "production" as critical', () => {
      const result = service.classify('Scale production servers', defaultScope, defaultConstraints);

      expect(result.level).toBe('critical');
      expect(result.reasons).toContain('involves_production_access');
    });

    it('classifies goal with "prod database" as critical', () => {
      const result = service.classify('Connect to prod database', defaultScope, defaultConstraints);

      expect(result.level).toBe('critical');
      expect(result.reasons).toContain('involves_production_access');
    });

    it('classifies goal with "prod environment" as critical', () => {
      const result = service.classify('Check prod environment status', defaultScope, defaultConstraints);

      expect(result.level).toBe('critical');
      expect(result.reasons).toContain('involves_production_access');
    });

    it('overrides high-level auth with critical when production is present', () => {
      const result = service.classify('Fix auth in production', defaultScope, defaultConstraints);

      expect(result.level).toBe('critical');
    });
  });
});
