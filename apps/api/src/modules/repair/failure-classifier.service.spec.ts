import { FailureClassifierService } from './failure-classifier.service';

describe('FailureClassifierService', () => {
  let service: FailureClassifierService;

  beforeEach(() => {
    service = new FailureClassifierService();
  });

  describe('eslint error classified as lint_failure', () => {
    it('classifies eslint error as lint_failure', () => {
      const result = service.classify('eslint: error no-unused-vars');

      expect(result).toBe('lint_failure');
    });

    it('classifies prettier error as formatting_failure', () => {
      const result = service.classify('prettier: formatting mismatch');

      expect(result).toBe('formatting_failure');
    });

    it('classifies lint error as lint_failure', () => {
      const result = service.classify('lint: unexpected token');

      expect(result).toBe('lint_failure');
    });

    it('classifies eslint error case insensitively', () => {
      const result = service.classify('ESLINT check failed');

      expect(result).toBe('lint_failure');
    });
  });

  describe('type error classified as type_error', () => {
    it('classifies "type error" as type_error', () => {
      const result = service.classify('type error: string is not assignable to number');

      expect(result).toBe('type_error');
    });

    it('classifies TypeScript error code as type_error', () => {
      const result = service.classify('src/main.ts(10,5): error ts(2322)');

      expect(result).toBe('type_error');
    });

    it('classifies "cannot find name" as type_error', () => {
      const result = service.classify('error: cannot find name "foo"');

      expect(result).toBe('type_error');
    });

    it('classifies type error case insensitively', () => {
      const result = service.classify('Type Error detected');

      expect(result).toBe('type_error');
    });
  });

  describe('test failure classified as unit_test_failure', () => {
    it('classifies "test failed" as unit_test_failure', () => {
      const result = service.classify('test failed: expected 42 but got 0');

      expect(result).toBe('unit_test_failure');
    });

    it('classifies assertion error as unit_test_failure', () => {
      const result = service.classify('assertion error: values do not match');

      expect(result).toBe('unit_test_failure');
    });

    it('classifies expect().toBe() failure as unit_test_failure', () => {
      const result = service.classify('expect(received).toBe(expected)');

      expect(result).toBe('unit_test_failure');
    });
  });

  describe('security scan classified as security_scan_failure', () => {
    it('classifies "sast" as security_scan_failure', () => {
      const result = service.classify('sast scan found vulnerabilities');

      expect(result).toBe('security_scan_failure');
    });

    it('classifies "security" as security_scan_failure', () => {
      const result = service.classify('security: vulnerability detected in dependency');

      expect(result).toBe('security_scan_failure');
    });

    it('classifies "vulnerability" as security_scan_failure', () => {
      const result = service.classify('vulnerability CVE-2024-1234 found');

      expect(result).toBe('security_scan_failure');
    });

    it('classifies "cve" as security_scan_failure', () => {
      const result = service.classify('CVE-2024-0001 detected in lodash');

      expect(result).toBe('security_scan_failure');
    });
  });

  describe('terraform error classified as infrastructure_plan_failure', () => {
    it('classifies "terraform" error as infrastructure_plan_failure', () => {
      const result = service.classify('terraform plan failed: resource conflict');

      expect(result).toBe('infrastructure_plan_failure');
    });

    it('classifies "kubernetes" error as infrastructure_plan_failure', () => {
      const result = service.classify('kubernetes deployment failed');

      expect(result).toBe('infrastructure_plan_failure');
    });

    it('classifies "infrastructure" error as infrastructure_plan_failure', () => {
      const result = service.classify('infrastructure provisioning error');

      expect(result).toBe('infrastructure_plan_failure');
    });
  });

  describe('unknown error defaults to unit_test_failure', () => {
    it('defaults to unit_test_failure for unrecognized errors', () => {
      const result = service.classify('something went wrong');

      expect(result).toBe('unit_test_failure');
    });

    it('defaults to unit_test_failure for empty string', () => {
      const result = service.classify('');

      expect(result).toBe('unit_test_failure');
    });

    it('defaults to unit_test_failure for random log output', () => {
      const result = service.classify('build completed with exit code 1');

      expect(result).toBe('unit_test_failure');
    });
  });

  describe('additional classifications', () => {
    it('classifies integration failure', () => {
      const result = service.classify('integration test fail: service unavailable');

      expect(result).toBe('integration_failure');
    });

    it('classifies e2e failure', () => {
      const result = service.classify('e2e fail: timeout exceeded');

      expect(result).toBe('integration_failure');
    });

    it('classifies flaky test', () => {
      const result = service.classify('flaky test detected: intermittent timeout');

      expect(result).toBe('flaky_test');
    });

    it('classifies timeout as flaky test', () => {
      const result = service.classify('timeout waiting for response');

      expect(result).toBe('flaky_test');
    });

    it('classifies dependency install failure', () => {
      const result = service.classify('npm install failed: module not found');

      expect(result).toBe('dependency_install_failure');
    });

    it('classifies pip install failure as dependency_install_failure', () => {
      const result = service.classify('pip install error');

      expect(result).toBe('dependency_install_failure');
    });

    it('classifies migration failure', () => {
      const result = service.classify('migration failed: alter table conflict');

      expect(result).toBe('migration_failure');
    });

    it('classifies schema error as migration_failure', () => {
      const result = service.classify('schema validation error');

      expect(result).toBe('migration_failure');
    });

    it('classifies policy violation', () => {
      const result = service.classify('policy denied: operation not allowed');

      expect(result).toBe('policy_violation');
    });

    it('classifies forbidden access as policy_violation', () => {
      const result = service.classify('forbidden: access denied');

      expect(result).toBe('policy_violation');
    });

    it('classifies format error as formatting_failure', () => {
      const result = service.classify('format check failed');

      expect(result).toBe('formatting_failure');
    });

    it('classifies indent error as formatting_failure', () => {
      const result = service.classify('indent error in file');

      expect(result).toBe('formatting_failure');
    });
  });

  describe('classification rule ordering', () => {
    it('returns first matching classification for ambiguous input', () => {
      // "eslint" matches lint_failure before "prettier" matches formatting_failure
      const result = service.classify('eslint and prettier errors');

      expect(result).toBe('lint_failure');
    });
  });
});
