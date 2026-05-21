import { Injectable } from '@nestjs/common';
import { PolicyService } from './policy.service.js';
import type { EffectivePolicy } from '@aicp/shared';
import { DEFAULT_POLICY } from '@aicp/shared';
import type { FilesystemMode, NetworkMode, SecretsMode } from '@aicp/shared';

const FILESYSTEM_RESTRICTION_ORDER: FilesystemMode[] = ['read_only', 'workspace_write', 'full_access'];
const NETWORK_RESTRICTION_ORDER: NetworkMode[] = ['disabled', 'allowlist', 'unrestricted'];
const SECRETS_RESTRICTION_ORDER: SecretsMode[] = ['none', 'setup_only', 'task_scoped'];

@Injectable()
export class PolicyResolverService {
  constructor(private readonly policyService: PolicyService) {}

  async resolveEffectivePolicy(
    repoId: string,
    path?: string,
    taskOverrides?: Partial<EffectivePolicy>,
  ): Promise<EffectivePolicy> {
    const layers = await this.policyService.findByRepo(repoId);

    let effective = this.getDefaultPolicy();

    for (const layer of layers) {
      const layerPolicy = layer.policy as Partial<EffectivePolicy>;

      if (layer.path && path && !path.startsWith(layer.path)) {
        continue;
      }

      effective = this.mergePolicies(effective, layerPolicy);
    }

    if (taskOverrides) {
      effective = this.mergePolicies(effective, taskOverrides);
    }

    return effective;
  }

  validatePolicy(policy: Record<string, unknown>): {
    valid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (policy.filesystem === 'full_access') {
      warnings.push('full_access filesystem mode should only be used in externally-isolated environments');
    }

    if (policy.network === 'unrestricted') {
      errors.push('unrestricted network access is not allowed');
    }

    if (policy.secrets === 'task_scoped' && !Array.isArray((policy as { secretsRefs?: unknown }).secretsRefs)) {
      warnings.push('task_scoped secrets mode requires secretsRefs to be specified');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  async simulatePolicy(
    repoId: string,
    path: string | undefined,
    overrides: Record<string, unknown>,
  ): Promise<EffectivePolicy> {
    const current = await this.resolveEffectivePolicy(repoId, path);
    return this.mergePolicies(current, overrides as Partial<EffectivePolicy>);
  }

  private getDefaultPolicy(): EffectivePolicy {
    return {
      filesystem: DEFAULT_POLICY.filesystem,
      allowedPaths: [],
      forbiddenPaths: [],
      allowedCommands: [],
      deniedCommands: [],
      network: {
        mode: DEFAULT_POLICY.network,
        domains: [],
        methods: [],
      },
      secrets: {
        mode: DEFAULT_POLICY.secrets,
        refs: [],
      },
      mcp: {
        allowedServers: [],
        deniedServers: [],
      },
    };
  }

  private mergePolicies(
    base: EffectivePolicy,
    override: Partial<EffectivePolicy>,
  ): EffectivePolicy {
    return {
      filesystem: this.pickMoreRestrictive(
        base.filesystem,
        override.filesystem,
        FILESYSTEM_RESTRICTION_ORDER,
      ),
      allowedPaths: override.allowedPaths ?? base.allowedPaths,
      forbiddenPaths: [...new Set([...base.forbiddenPaths, ...(override.forbiddenPaths ?? [])])],
      allowedCommands: override.allowedCommands ?? base.allowedCommands,
      deniedCommands: [...new Set([...base.deniedCommands, ...(override.deniedCommands ?? [])])],
      network: {
        mode: this.pickMoreRestrictive(
          base.network.mode,
          override.network?.mode,
          NETWORK_RESTRICTION_ORDER,
        ),
        domains: override.network?.domains ?? base.network.domains,
        methods: override.network?.methods ?? base.network.methods,
      },
      secrets: {
        mode: this.pickMoreRestrictive(
          base.secrets.mode,
          override.secrets?.mode,
          SECRETS_RESTRICTION_ORDER,
        ),
        refs: override.secrets?.refs ?? base.secrets.refs,
      },
      mcp: {
        allowedServers: override.mcp?.allowedServers ?? base.mcp.allowedServers,
        deniedServers: [...new Set([...base.mcp.deniedServers, ...(override.mcp?.deniedServers ?? [])])],
      },
    };
  }

  private pickMoreRestrictive<T extends string>(
    current: T,
    override: T | undefined,
    order: T[],
  ): T {
    if (!override) return current;
    const currentIdx = order.indexOf(current);
    const overrideIdx = order.indexOf(override);
    return overrideIdx < currentIdx ? override : current;
  }
}
