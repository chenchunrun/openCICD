import { CompletenessValidatorService } from './completeness-validator.service';

describe('CompletenessValidatorService', () => {
  let service: CompletenessValidatorService;

  beforeEach(() => {
    service = new CompletenessValidatorService();
  });

  const validInput = {
    goal: 'Fix the login bug',
    scope: { allowedPaths: ['src/auth/**'], forbiddenPaths: [] },
    doneWhen: ['All tests pass'],
  };

  describe('valid task passes', () => {
    it('returns valid when goal, scope, and doneWhen are all present', () => {
      const result = service.validate(validInput);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });

  describe('missing goal fails', () => {
    it('returns error when goal is empty string', () => {
      const result = service.validate({
        ...validInput,
        goal: '',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Task must have a clear goal');
    });

    it('returns error when goal is only whitespace', () => {
      const result = service.validate({
        ...validInput,
        goal: '   ',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Task must have a clear goal');
    });

    it('returns error when goal is undefined', () => {
      const result = service.validate({
        goal: undefined as unknown as string,
        scope: validInput.scope,
        doneWhen: validInput.doneWhen,
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Task must have a clear goal');
    });
  });

  describe('missing scope fails', () => {
    it('returns error when allowedPaths is empty', () => {
      const result = service.validate({
        ...validInput,
        scope: { allowedPaths: [], forbiddenPaths: [] },
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Task must define scope with at least one allowed path');
    });

    it('returns error when scope is undefined', () => {
      const result = service.validate({
        goal: validInput.goal,
        scope: undefined as unknown as { allowedPaths: string[]; forbiddenPaths: string[] },
        doneWhen: validInput.doneWhen,
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Task must define scope with at least one allowed path');
    });
  });

  describe('missing doneWhen fails', () => {
    it('returns error when doneWhen is empty array', () => {
      const result = service.validate({
        ...validInput,
        doneWhen: [],
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Task must define done_when criteria');
    });

    it('returns error when doneWhen is undefined', () => {
      const result = service.validate({
        goal: validInput.goal,
        scope: validInput.scope,
        doneWhen: undefined as unknown as string[],
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Task must define done_when criteria');
    });
  });

  describe('goal requesting secrets fails', () => {
    it('rejects goal containing "read secrets"', () => {
      const result = service.validate({
        ...validInput,
        goal: 'Read secrets from the environment',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Task must not request secrets access');
    });

    it('rejects goal containing "access secrets" (case insensitive)', () => {
      const result = service.validate({
        ...validInput,
        goal: 'Access Secrets for debugging',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Task must not request secrets access');
    });
  });

  describe('goal requesting deploy to production fails', () => {
    it('rejects goal containing "deploy to production"', () => {
      const result = service.validate({
        ...validInput,
        goal: 'Deploy to production immediately',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Task must not request direct production deployment');
    });

    it('rejects goal containing "directly deploy" (case insensitive)', () => {
      const result = service.validate({
        ...validInput,
        goal: 'Directly Deploy the build',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Task must not request direct production deployment');
    });
  });

  describe('goal requesting bypass review fails', () => {
    it('rejects goal containing "bypass review"', () => {
      const result = service.validate({
        ...validInput,
        goal: 'Bypass review and merge',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Task must not attempt to bypass review');
    });

    it('rejects goal containing "skip review" (case insensitive)', () => {
      const result = service.validate({
        ...validInput,
        goal: 'Skip Review for hotfix',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Task must not attempt to bypass review');
    });
  });

  describe('goal requesting skip CI fails', () => {
    it('rejects goal containing "skip ci"', () => {
      const result = service.validate({
        ...validInput,
        goal: 'Skip CI and push directly',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Task must not attempt to bypass CI');
    });

    it('rejects goal containing "bypass ci" (case insensitive)', () => {
      const result = service.validate({
        ...validInput,
        goal: 'Bypass CI checks',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Task must not attempt to bypass CI');
    });
  });

  describe('goal requesting delete tests fails', () => {
    it('rejects goal containing "delete tests"', () => {
      const result = service.validate({
        ...validInput,
        goal: 'Delete tests that are flaky',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Task must not request test deletion');
    });

    it('rejects goal containing "remove tests" (case insensitive)', () => {
      const result = service.validate({
        ...validInput,
        goal: 'Remove Tests to clean up',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Task must not request test deletion');
    });

    it('rejects constraint containing "delete tests"', () => {
      const result = service.validate({
        ...validInput,
        constraints: ['Delete tests that are not needed'],
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Task must not request test deletion');
    });

    it('rejects constraint containing "remove tests"', () => {
      const result = service.validate({
        ...validInput,
        constraints: ['Remove tests for deprecated features'],
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Task must not request test deletion');
    });
  });

  describe('multiple violations accumulate', () => {
    it('returns all errors when multiple conditions fail', () => {
      const result = service.validate({
        goal: '',
        scope: { allowedPaths: [], forbiddenPaths: [] },
        doneWhen: [],
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(3);
      expect(result.errors).toContain('Task must have a clear goal');
      expect(result.errors).toContain('Task must define scope with at least one allowed path');
      expect(result.errors).toContain('Task must define done_when criteria');
    });
  });
});
