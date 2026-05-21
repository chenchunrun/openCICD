import type { RiskLevel } from '../types/enums.js';

export const RISK_LEVELS: readonly RiskLevel[] = ['low', 'medium', 'high', 'critical'] as const;

export const RISK_AUTO_POLICIES: Record<RiskLevel, {
  canAutoGeneratePr: boolean;
  canAutoReview: boolean;
  requiresCiPass: boolean;
  requiresHumanReview: boolean;
  requiresPreApproval: boolean;
  requiresCodeOwner: boolean;
  humanLedOnly: boolean;
}> = {
  low: {
    canAutoGeneratePr: true,
    canAutoReview: true,
    requiresCiPass: false,
    requiresHumanReview: false,
    requiresPreApproval: false,
    requiresCodeOwner: false,
    humanLedOnly: false,
  },
  medium: {
    canAutoGeneratePr: true,
    canAutoReview: false,
    requiresCiPass: true,
    requiresHumanReview: true,
    requiresPreApproval: false,
    requiresCodeOwner: false,
    humanLedOnly: false,
  },
  high: {
    canAutoGeneratePr: false,
    canAutoReview: false,
    requiresCiPass: true,
    requiresHumanReview: true,
    requiresPreApproval: true,
    requiresCodeOwner: true,
    humanLedOnly: false,
  },
  critical: {
    canAutoGeneratePr: false,
    canAutoReview: false,
    requiresCiPass: true,
    requiresHumanReview: true,
    requiresPreApproval: true,
    requiresCodeOwner: true,
    humanLedOnly: true,
  },
};
