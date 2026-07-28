/**
 * Facteur de vraisemblance par arête cause→effet.
 */
import { getCause, getLrTier, getQuantity } from './knowledge-loader.js';
import { isBandConcordant } from './read-observation.js';
import { resolveEffectForContext } from './resolve-effect.js';
import type { Band, CaseContext, ParsedObservation } from './types.js';

export function likelihoodFactor(
  causeId: string,
  observation: ParsedObservation,
  context: CaseContext = { equipment_type: 'pac_air_eau' },
): number {
  const cause = getCause(causeId);
  if (!cause) return 1;

  const effect = resolveEffectForContext(cause.effects, observation.quantity_id, context);
  if (!effect) return 1;

  const lr = getLrTier(effect.lr, effect.status);

  if (observation.kind === 'qualitative') {
    if (effect.value == null) return 1;
    return observation.modality === effect.value ? lr : 1 / lr;
  }

  if (effect.direction == null) {
    if (effect.value != null) return 1;
    return 1;
  }

  const concordant = isBandConcordant(effect.direction, observation.band);
  return concordant ? lr : 1 / lr;
}

export function bandsForQuantity(quantityId: string): Band[] {
  return ['below', 'in', 'above'];
}

export function modalitiesForQuantity(quantityId: string): string[] {
  const q = getQuantity(quantityId);
  return q?.modalities ?? [];
}
