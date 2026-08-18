import { FilterRules } from '../types/giveaway';
import { RawParticipant } from '../types/participant';
import { SocialMediaProvider } from '../../providers/types';
import { applyFilterRules, FilterResult } from '../filtering/filter-engine';

export interface EnrichmentPipelineParams {
  rawParticipants: RawParticipant[];
  rules: FilterRules;
  provider: SocialMediaProvider;
  ownerId: string;
  organizerId?: string;
}

/**
 * Executes full participant enrichment and filtering pipeline:
 * 1. Takes raw participants
 * 2. Checks community subscription via provider if requireSubscription is true
 * 3. Enriches participants with subscription status
 * 4. Applies FilterEngine to determine final eligibility
 */
export async function executeParticipantPipeline(
  params: EnrichmentPipelineParams
): Promise<FilterResult> {
  const { rawParticipants, rules, provider, ownerId, organizerId } = params;

  let enrichedParticipants = rawParticipants.map(p => ({ ...p }));

  // Subscription Enrichment Step
  if (rules.requireSubscription) {
    const userIds = Array.from(new Set(enrichedParticipants.map(p => p.platformUserId)));
    const targetGroupId = rules.targetGroupId || (ownerId.startsWith('-') ? ownerId : undefined);

    if (targetGroupId && userIds.length > 0 && provider.capabilities.subscriptions) {
      const subMap = organizerId
        ? await provider.checkSubscription(userIds, targetGroupId, { organizerId })
        : await provider.checkSubscription(userIds, targetGroupId);

      for (const p of enrichedParticipants) {
        p.subscribed = Boolean(subMap.get(p.platformUserId));
      }
    }
  }

  // Filter Engine Step
  return applyFilterRules(enrichedParticipants, rules);
}
