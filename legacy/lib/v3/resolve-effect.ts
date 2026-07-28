/**
 * Résolution d'arête cause→effet selon operating_state du contexte.
 */
import type { CaseContext, CauseEffect } from './types.js';

export function resolveEffectForContext(
  effects: CauseEffect[],
  quantityId: string,
  context: CaseContext,
): CauseEffect | undefined {
  const candidates = effects.filter((e) => e.quantity === quantityId);
  if (!candidates.length) return undefined;
  if (candidates.length === 1) return candidates[0];

  const state = context.operating_state ?? 'regime_etabli';
  return (
    candidates.find((e) => e.operating_state === state) ??
    candidates.find((e) => e.operating_state === 'regime_etabli') ??
    candidates.find((e) => !e.operating_state) ??
    candidates[0]
  );
}
