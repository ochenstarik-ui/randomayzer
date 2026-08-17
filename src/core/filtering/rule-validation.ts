import { FilterRules } from '../types/giveaway';
import { ProviderCapabilities } from '../../providers/types';

export interface RuleValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates that the requested filter rules can actually be verified by the
 * selected social-media provider. This prevents organizers from configuring
 * giveaways with conditions (e.g. reposts) that the provider cannot check.
 */
export function validateFilterRulesAgainstProviderCapabilities(
  rules: FilterRules,
  capabilities: ProviderCapabilities
): RuleValidationResult {
  const errors: string[] = [];

  if (rules.requireRepost && !capabilities.reposts) {
    errors.push(
      `requireRepost is not supported by the ${capabilities.repostsNote || 'current provider'}`
    );
  }

  if (rules.requireSubscription && !capabilities.subscriptions) {
    errors.push('requireSubscription is not supported by the current provider');
  }

  if (rules.excludeAdmins && !capabilities.adminDetection) {
    errors.push(
      `excludeAdmins is not supported by the ${capabilities.adminDetectionNote || 'current provider'}`
    );
  }

  // likes/comments are considered universally supported by providers that have
  // them declared; the engine itself still needs a provider to fetch them.

  return {
    valid: errors.length === 0,
    errors,
  };
}
