import { PolicyResolverService } from './policy-resolver.service';
import { PolicyService } from './policy.service';

describe('PolicyResolverService', () => {
  let service: PolicyResolverService;
  let policyServiceMock: { findByRepo: jest.Mock };

  beforeEach(() => {
    policyServiceMock = {
      findByRepo: jest.fn().mockResolvedValue([]),
    };
    service = new PolicyResolverService(
      policyServiceMock as unknown as PolicyService,
    );
  });

  describe('default policy returns workspace_write filesystem', () => {
    it('returns workspace_write as the default filesystem mode', async () => {
      const result = await service.resolveEffectivePolicy('repo-1');

      expect(result.filesystem).toBe('workspace_write');
    });
  });

  describe('default policy returns disabled network', () => {
    it('returns disabled as the default network mode', async () => {
      const result = await service.resolveEffectivePolicy('repo-1');

      expect(result.network.mode).toBe('disabled');
    });
  });

  describe('default policy returns none secrets', () => {
    it('returns none as the default secrets mode', async () => {
      const result = await service.resolveEffectivePolicy('repo-1');

      expect(result.secrets.mode).toBe('none');
    });
  });

  describe('policy validation rejects unrestricted network', () => {
    it('returns invalid for unrestricted network', () => {
      const result = service.validatePolicy({ network: 'unrestricted' });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('unrestricted network access is not allowed');
    });

    it('returns valid for disabled network', () => {
      const result = service.validatePolicy({ network: 'disabled' });

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('returns valid for allowlist network', () => {
      const result = service.validatePolicy({ network: 'allowlist' });

      expect(result.valid).toBe(true);
    });
  });

  describe('policy validation warns on full_access filesystem', () => {
    it('warns when filesystem is full_access', () => {
      const result = service.validatePolicy({ filesystem: 'full_access' });

      expect(result.valid).toBe(true);
      expect(result.warnings).toContain(
        'full_access filesystem mode should only be used in externally-isolated environments',
      );
    });

    it('does not warn when filesystem is workspace_write', () => {
      const result = service.validatePolicy({ filesystem: 'workspace_write' });

      expect(result.warnings).not.toContain(
        expect.stringContaining('full_access'),
      );
    });

    it('does not warn when filesystem is read_only', () => {
      const result = service.validatePolicy({ filesystem: 'read_only' });

      expect(result.warnings).toEqual([]);
    });
  });

  describe('task_scoped secrets without secretsRefs warns', () => {
    it('warns when secrets is task_scoped without secretsRefs', () => {
      const result = service.validatePolicy({ secrets: 'task_scoped' });

      expect(result.warnings).toContain(
        'task_scoped secrets mode requires secretsRefs to be specified',
      );
    });
  });

  describe('policy layer merging', () => {
    it('applies more restrictive filesystem mode from layer', async () => {
      policyServiceMock.findByRepo.mockResolvedValue([
        { path: null, policy: { filesystem: 'read_only' } },
      ]);

      const result = await service.resolveEffectivePolicy('repo-1');

      expect(result.filesystem).toBe('read_only');
    });

    it('keeps more restrictive mode when layer tries to widen', async () => {
      policyServiceMock.findByRepo.mockResolvedValue([
        { path: null, policy: { filesystem: 'read_only' } },
      ]);

      const result = await service.resolveEffectivePolicy('repo-1', undefined, {
        filesystem: 'full_access',
      });

      // read_only is more restrictive than full_access, so it should stay
      expect(result.filesystem).toBe('read_only');
    });

    it('applies task overrides over repo policy', async () => {
      policyServiceMock.findByRepo.mockResolvedValue([
        { path: null, policy: { filesystem: 'workspace_write' } },
      ]);

      const result = await service.resolveEffectivePolicy('repo-1', undefined, {
        filesystem: 'read_only',
      });

      expect(result.filesystem).toBe('read_only');
    });

    it('skips layers whose path does not match', async () => {
      policyServiceMock.findByRepo.mockResolvedValue([
        { path: 'src/auth/', policy: { filesystem: 'read_only' } },
      ]);

      const result = await service.resolveEffectivePolicy('repo-1', 'src/utils/helper.ts');

      // Should use default since path does not match
      expect(result.filesystem).toBe('workspace_write');
    });

    it('applies layers whose path matches', async () => {
      policyServiceMock.findByRepo.mockResolvedValue([
        { path: 'src/auth/', policy: { filesystem: 'read_only' } },
      ]);

      const result = await service.resolveEffectivePolicy('repo-1', 'src/auth/handler.ts');

      expect(result.filesystem).toBe('read_only');
    });
  });

  describe('simulatePolicy', () => {
    it('returns merged policy from current and overrides', async () => {
      const result = await service.simulatePolicy('repo-1', undefined, {
        filesystem: 'read_only',
      });

      expect(result.filesystem).toBe('read_only');
    });
  });

  describe('forbiddenPaths and deniedCommands merging', () => {
    it('merges forbiddenPaths from layers', async () => {
      policyServiceMock.findByRepo.mockResolvedValue([
        { path: null, policy: { forbiddenPaths: ['/etc/passwd'] } },
      ]);

      const result = await service.resolveEffectivePolicy('repo-1');

      expect(result.forbiddenPaths).toContain('/etc/passwd');
    });

    it('deduplicates forbiddenPaths', async () => {
      policyServiceMock.findByRepo.mockResolvedValue([
        { path: null, policy: { forbiddenPaths: ['/etc/passwd'] } },
      ]);

      const result = await service.resolveEffectivePolicy('repo-1', undefined, {
        forbiddenPaths: ['/etc/passwd', '/etc/shadow'],
      });

      expect(result.forbiddenPaths.filter((p) => p === '/etc/passwd')).toHaveLength(1);
      expect(result.forbiddenPaths).toContain('/etc/shadow');
    });

    it('merges deniedCommands from layers', async () => {
      policyServiceMock.findByRepo.mockResolvedValue([
        { path: null, policy: { deniedCommands: ['rm -rf /'] } },
      ]);

      const result = await service.resolveEffectivePolicy('repo-1');

      expect(result.deniedCommands).toContain('rm -rf /');
    });
  });
});
