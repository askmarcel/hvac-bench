/**
 * Oracle O_bayes — un cas pilote. Conclusion uniquement via shouldConclude (seuil 0,85).
 * resolves marque discriminantExecuted + facteur bayésien, sans court-circuit.
 */
import {
  bayesUpdate,
  buildTestFromCaseAnnotation,
  shouldConclude,
  type HypothesisState,
} from '../lib/bayes-engine.js';
import { buildRunRecord, lookupObservation, T_MAX, type PilotCaseExtended } from './v2-harness.js';

export const O_BAYES_MIN_CONV_AT_5 = 11 / 15;
/** @deprecated Cible audit pré-polarité — remplacée par snapshot + plancher 11/15 */
export const O_BAYES_TARGET_CONV_AT_5 = 13 / 15;

export type ObayesRunOptions = {
  conclusionThreshold?: number;
};

export function runCaseObayes(
  c: PilotCaseExtended,
  replicate: number,
  options?: ObayesRunOptions,
) {
  const threshold = options?.conclusionThreshold;
  const path: string[] = [];
  let hypotheses: HypothesisState[] = c.hypotheses.map((h) => ({
    id: h.id,
    label: h.label ?? h.id,
    prior: h.prior ?? 1 / c.hypotheses.length,
    n_observations: (h as { n_observations?: number }).n_observations,
  }));
  let discriminantExecuted = false;
  let turns = 0;
  let concluded = false;
  let cause_id: string | null = null;
  let final_output: Record<string, unknown> = { state: 'non_convergent' };

  for (const actionId of c.expert_path) {
    if (turns >= T_MAX) break;
    const testRow = c.tests.find((t) => t.action_id === actionId);
    const { observation } = lookupObservation(c, actionId);
    path.push(actionId);
    turns++;

    const test = buildTestFromCaseAnnotation(
      actionId,
      observation,
      testRow?.discriminates ?? [],
      testRow?.eliminates ?? [],
      testRow?.resolves,
    );
    if (testRow?.polarity) {
      test.polarity = testRow.polarity as 'supports' | 'refutes' | 'neutral';
    }

    if (test.discriminates.length > 0 || test.resolves) {
      discriminantExecuted = true;
    }
    hypotheses = bayesUpdate(hypotheses, test);

    const { conclude, causeId } = shouldConclude(hypotheses, discriminantExecuted, threshold);
    if (conclude && causeId) {
      concluded = true;
      cause_id = causeId;
      final_output = {
        state: 'conclusion',
        cause_id: causeId,
        hypotheses_ranked: hypotheses,
        turn: turns,
      };
      break;
    }
  }

  if (!concluded && turns >= T_MAX) {
    final_output = { state: 'escalation', turn: turns };
  } else if (!concluded) {
    final_output = {
      state: 'non_convergent',
      hypotheses_ranked: hypotheses,
      turn: turns,
    };
  }

  return buildRunRecord({
    c,
    arm: 'O_bayes',
    replicate,
    path,
    concluded,
    cause_id,
    turns,
    final_output,
    hypotheses_final: hypotheses,
  });
}
