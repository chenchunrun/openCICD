import { Injectable } from '@nestjs/common';
import { HIGH_RISK_PATH_PATTERNS, matchGlob } from '@aicp/shared';
import type { RiskLevel } from '@aicp/shared';

export interface RiskClassification {
  level: RiskLevel;
  reasons: string[];
}

@Injectable()
export class RiskClassifierService {
  classify(
    goal: string,
    scope: { allowedPaths: string[]; forbiddenPaths: string[] },
    constraints: string[],
  ): RiskClassification {
    const reasons: string[] = [];
    let level: RiskLevel = 'low';

    const goalLower = goal.toLowerCase();
    const allPaths = [...scope.allowedPaths, ...scope.forbiddenPaths];

    if (goalLower.includes('docs') || goalLower.includes('formatting') || goalLower.includes('typo')) {
      return { level: 'low', reasons: ['documentation_or_formatting'] };
    }

    const highRiskMatches = allPaths.filter((p) =>
      HIGH_RISK_PATH_PATTERNS.some((pattern) => matchGlob(pattern, p)),
    );

    if (this.touchesAuth(goalLower, allPaths)) {
      level = 'high';
      reasons.push('touches_auth_logic');
    }

    if (this.touchesPayments(goalLower, allPaths)) {
      level = 'high';
      reasons.push('touches_payments');
    }

    if (this.touchesInfra(goalLower, allPaths)) {
      level = 'high';
      reasons.push('touches_infrastructure');
    }

    if (this.touchesMigrations(goalLower, allPaths)) {
      level = 'high';
      reasons.push('touches_migrations');
    }

    if (this.touchesSecrets(goalLower, constraints)) {
      level = 'critical';
      reasons.push('involves_secrets');
    }

    if (this.touchesProduction(goalLower)) {
      level = 'critical';
      reasons.push('involves_production_access');
    }

    if (level === 'low' && (highRiskMatches.length > 0 || reasons.length > 0)) {
      level = 'medium';
    }

    if (reasons.length === 0) {
      reasons.push('standard_business_logic');
      level = 'medium';
    }

    return { level, reasons };
  }

  private touchesAuth(goal: string, paths: string[]): boolean {
    return (
      goal.includes('auth') ||
      goal.includes('login') ||
      goal.includes('token') ||
      goal.includes('session') ||
      paths.some((p) => p.includes('auth'))
    );
  }

  private touchesPayments(goal: string, paths: string[]): boolean {
    return (
      goal.includes('payment') ||
      goal.includes('billing') ||
      goal.includes('charge') ||
      paths.some((p) => p.includes('payment'))
    );
  }

  private touchesInfra(goal: string, paths: string[]): boolean {
    return (
      goal.includes('terraform') ||
      goal.includes('kubernetes') ||
      goal.includes('deploy') ||
      paths.some((p) => p.includes('infra') || p.includes('terraform') || p.includes('k8s'))
    );
  }

  private touchesMigrations(goal: string, paths: string[]): boolean {
    return (
      goal.includes('migration') ||
      goal.includes('schema') ||
      paths.some((p) => p.includes('migration'))
    );
  }

  private touchesSecrets(goal: string, constraints: string[]): boolean {
    return (
      goal.includes('secret') ||
      goal.includes('credential') ||
      goal.includes('api key') ||
      constraints.some((c) => c.toLowerCase().includes('secret'))
    );
  }

  private touchesProduction(goal: string): boolean {
    return (
      goal.includes('production') ||
      goal.includes('prod database') ||
      goal.includes('prod environment')
    );
  }
}
