/**
 * Mise à jour bayésienne v3 — polarité calculée depuis l'arbre.
 */
import { normalizePosterior, type HypothesisState } from '../bayes-engine.js';
import { CONFIRMATORY_RESOLVES_LR } from './constants.js';
import {
  causesTargetedByRepairAction,
  counterfactualOverlay,
  isRepairAction,
} from './counterfactual.js';
import { likelihoodFactor } from './likelihood.js';
import { readObservation } from './read-observation.js';
import type { CaseContext, V3Observation } from './types.js';

export function updatePosteriorV3(
  hypotheses: HypothesisState[],
  observation: V3Observation,
  context: CaseContext,
): HypothesisState[] {
  const parsed = readObservation(observation.reading, context);
  const overlay = counterfactualOverlay(observation, context);
  const overlayCauses = new Set(overlay.keys());

  const resolvesTargeted =
    observation.resolves === true && isRepairAction(observation.action_id)
      ? new Set(causesTargetedByRepairAction(observation.action_id))
      : null;

  const updated = hypotheses.map((h) => {
    if (resolvesTargeted?.has(h.id)) {
      return {
        ...h,
        prior: Math.max(h.prior * CONFIRMATORY_RESOLVES_LR, 1e-12),
      };
    }

    let factor: number;
    if (overlayCauses.has(h.id)) {
      factor = overlay.get(h.id)!;
    } else {
      factor = likelihoodFactor(h.id, parsed, context);
    }
    return { ...h, prior: Math.max(h.prior * factor, 1e-12) };
  });

  return normalizePosterior(updated);
}

export function applyInitialReadings(
  hypotheses: HypothesisState[],
  initialReadings: Record<string, import('./types.js').Reading> | undefined,
  context: CaseContext,
): HypothesisState[] {
  if (!initialReadings) return hypotheses;
  let state = hypotheses;
  for (const reading of Object.values(initialReadings)) {
    state = updatePosteriorV3(
      state,
      { action_id: `INIT-${reading.quantity_id}`, reading },
      context,
    );
  }
  return state;
}
