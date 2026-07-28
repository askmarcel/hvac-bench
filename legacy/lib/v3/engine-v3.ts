/**
 * API publique moteur v3 — bench.
 */
import {
  compareActionsTieBreak,
  entropy,
  PICK_ESCALATE,
  shouldConclude,
  VOI_LAMBDA_COST_BITS_PER_EUR,
  VOI_MIN_GAIN_EPSILON,
  type HypothesisState,
} from '../bayes-engine.js';
import { applyInitialReadings, updatePosteriorV3 } from './bayes-update-v3.js';
import { enrichCaseContext } from './operating-state.js';
import { initialHypothesesV3 } from './candidates.js';
import { computeActionEigV3, expectedEntropyAfterActionV3, buildV3HypothesisActionsMap } from './eig-v3.js';
import { diagnosticActionIdsV3 } from './hypothesis-actions.js';
import type { CaseContext, SessionStateV3, V3Case, V3Observation } from './types.js';

export function initSessionV3(v3Case: V3Case): SessionStateV3 {
  const code = v3Case.symptom.code_present ?? null;
  const context = enrichCaseContext(v3Case.context, v3Case.symptom);
  let hypotheses = initialHypothesesV3('pac_air_eau', code);
  hypotheses = applyInitialReadings(
    hypotheses,
    v3Case.initial_readings,
    context,
  );
  return {
    hypotheses,
    context,
    executed: new Set(),
    code,
  };
}

export function runObservationStep(
  state: SessionStateV3,
  observation: V3Observation,
): SessionStateV3 {
  const hypotheses = updatePosteriorV3(
    state.hypotheses,
    observation,
    state.context,
  );
  const executed = new Set(state.executed);
  executed.add(observation.action_id);
  return { ...state, hypotheses, executed };
}

/** Sélecteur VOI v3 — EIG depuis l'arbre, pas la matrice v2. */
export function pickNextActionV3(
  hypotheses: HypothesisState[],
  availableActionIds: string[],
  actionCosts: Map<string, number>,
  executed: Set<string>,
  context: CaseContext,
  hypothesisActions: Map<string, string[]>,
): string | null {
  const baseEntropy = entropy(hypotheses);
  const candidates: Array<{ id: string; score: number }> = [];
  let best: { id: string; score: number } | null = null;

  for (const actionId of availableActionIds) {
    if (executed.has(actionId)) continue;
    const cost = actionCosts.get(actionId) ?? 50;
    const expectedH = expectedEntropyAfterActionV3(hypotheses, actionId, context);
    const gain = baseEntropy - expectedH;
    if (gain < VOI_MIN_GAIN_EPSILON) continue;
    const score = gain - VOI_LAMBDA_COST_BITS_PER_EUR * cost;
    candidates.push({ id: actionId, score });
    if (!best || score > best.score) best = { id: actionId, score };
  }

  if (!best) return PICK_ESCALATE;

  const eps = 1e-9;
  const tied = candidates.filter((c) => Math.abs(c.score - best!.score) < eps);
  if (tied.length <= 1) return best.id;
  tied.sort((a, b) => compareActionsTieBreak(a.id, b.id));
  return tied[0]!.id;
}

export function scoreActionsV3(
  hypotheses: HypothesisState[],
  availableActionIds: string[],
  actionCosts: Map<string, number>,
  executed: Set<string>,
  context: CaseContext,
): string | null {
  const hypothesisIds = hypotheses.map((h) => h.id);
  const hypothesisActions = buildV3HypothesisActionsMap(hypothesisIds);
  return pickNextActionV3(
    hypotheses,
    availableActionIds,
    actionCosts,
    executed,
    context,
    hypothesisActions,
  );
}

export function replayCaseV3(
  v3Case: V3Case,
  maxTurns = 20,
): {
  path: string[];
  finalHypotheses: HypothesisState[];
  concluded: { conclude: boolean; causeId: string | null };
} {
  let state = initSessionV3(v3Case);
  const path: string[] = [];

  for (let t = 0; t < maxTurns; t++) {
    const obs = v3Case.observations[t];
    if (!obs) break;
    state = runObservationStep(state, obs);
    path.push(obs.action_id);

    const discriminantDone = path.some((a) => a.startsWith('MES-') || a.startsWith('OBS-'));
    const conclusion = shouldConclude(state.hypotheses, discriminantDone);
    if (conclusion.conclude) {
      return { path, finalHypotheses: state.hypotheses, concluded: conclusion };
    }
  }

  const discriminantDone = path.some((a) => a.startsWith('MES-') || a.startsWith('OBS-'));
  return {
    path,
    finalHypotheses: state.hypotheses,
    concluded: shouldConclude(state.hypotheses, discriminantDone),
  };
}

export { diagnosticActionIdsV3, computeActionEigV3, updatePosteriorV3 };
