import { Injectable } from '@nestjs/common';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

@Injectable()
export class CompletenessValidatorService {
  validate(input: {
    goal: string;
    scope: { allowedPaths: string[]; forbiddenPaths: string[] };
    doneWhen: string[];
    constraints?: string[];
  }): ValidationResult {
    const errors: string[] = [];
    const goal = input.goal ?? '';

    if (!goal || goal.trim().length === 0) {
      errors.push('Task must have a clear goal');
    }

    if (!input.scope?.allowedPaths || input.scope.allowedPaths.length === 0) {
      errors.push('Task must define scope with at least one allowed path');
    }

    if (!input.doneWhen || input.doneWhen.length === 0) {
      errors.push('Task must define done_when criteria');
    }

    const goalLower = goal.toLowerCase();
    if (goalLower.includes('read secrets') || goalLower.includes('access secrets')) {
      errors.push('Task must not request secrets access');
    }

    if (goalLower.includes('deploy to production') || goalLower.includes('directly deploy')) {
      errors.push('Task must not request direct production deployment');
    }

    if (goalLower.includes('bypass review') || goalLower.includes('skip review')) {
      errors.push('Task must not attempt to bypass review');
    }

    if (goalLower.includes('skip ci') || goalLower.includes('bypass ci')) {
      errors.push('Task must not attempt to bypass CI');
    }

    const allText = `${goal} ${(input.constraints ?? []).join(' ')}`.toLowerCase();
    if (allText.includes('delete tests') || allText.includes('remove tests')) {
      errors.push('Task must not request test deletion');
    }

    return { valid: errors.length === 0, errors };
  }
}
