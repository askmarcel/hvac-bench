/**
 * EIG v3 — entropie attendue depuis l'arbre (issues equiprobables).
 */
import {
  entropy,
  normalizePosterior,
  type HypothesisState,
} from '../bayes-engine.js';
import { getPrimaryQuantityForAction, getQuantity } from './knowledge-loader.js';
import { likelihoodFactor } from './likelihood.js';
import { buildHypothesisActionsMap } from './hypothesis-actions.js';
import type { Band, CaseContext, ParsedObservation } from './types.js';

function enumerateOutcomes(quantityId: string): ParsedObservation[] {
  const q = getQuantity(quantityId);
  if (!q) return [];

  if (q.kind === 'qualitative' && q.modalities?.length) {
    return q.modalities.map((modality) => ({
      kind: 'qualitative' as const,
      quantity_id: quantityId,
      modality,
    }));
  }

  return (['below', 'in', 'above'] as Band[]).map((band) => ({
    kind: 'numeric' as const,
    quantity_id: quantityId,
    band,
  }));
}

function posteriorForOutcome(
  hypotheses: HypothesisState[],
  outcome: ParsedObservation,
): HypothesisState[] {
  const updated = hypotheses.map((h) => {
    const factor = likelihoodFactor(h.id, outcome);
    return { ...h, prior: Math.max(h.prior * factor, 1e-12) };
  });
  return normalizePosterior(updated);
}

export function expectedEntropyAfterActionV3(
  hypotheses: HypothesisState[],
  actionId: string,
  _context: CaseContext,
): number {
  const quantityId = getPrimaryQuantityForAction(actionId);
  if (!quantityId) return entropy(hypotheses);

  const outcomes = enumerateOutcomes(quantityId);
  if (outcomes.length === 0) return entropy(hypotheses);

  const n = outcomes.length;
  let expected = 0;
  for (const outcome of outcomes) {
    const post = posteriorForOutcome(hypotheses, outcome);
    expected += (1 / n) * entropy(post);
  }
  return expected;
}

export function computeActionEigV3(
  hypotheses: HypothesisState[],
  actionId: string,
  context: CaseContext,
): number {
  const base = entropy(hypotheses);
  const expected = expectedEntropyAfterActionV3(hypotheses, actionId, context);
  return Math.max(0, base - expected);
}

export function buildV3HypothesisActionsMap(
  hypothesisIds: string[],
): Map<string, string[]> {
  return buildHypothesisActionsMap(hypothesisIds);
}

export function actionHasTreeCoverage(
  actionId: string,
  hypothesisIds: string[],
): boolean {
  const ha = buildHypothesisActionsMap(hypothesisIds);
  return hypothesisIds.some((id) => (ha.get(id) ?? []).includes(actionId));
}
