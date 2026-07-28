/**
 * Moteur bayésien minimal pour oracles bench (O_bayes, O_bayes_db).
 * Miroir de AskMarcel-WebApp-NextJS/lib/diagnostic-v2/engine.ts
 */
import { getConclusionThreshold, getLikelihoodFactors } from './likelihoods-config.js';

export type HypothesisState = {
  id: string;
  label: string;
  prior: number;
  n_observations?: number;
};

export type CaseTest = {
  action_id: string;
  observation: string;
  discriminates: string[];
  eliminates: string[];
  resolves?: boolean;
  polarity?: TestPolarity;
};

/** Seuil pinné dans config/likelihoods-v2.json (calibré sur pilote). */
export const CONCLUSION_THRESHOLD = getConclusionThreshold();
export const RESIDUAL_HYPOTHESIS_ID = 'cause_inconnue';

export function isConcludableHypothesis(id: string): boolean {
  return id !== RESIDUAL_HYPOTHESIS_ID;
}
export const VOI_LAMBDA_COST_BITS_PER_EUR = 0.002;
export const VOI_MIN_GAIN_EPSILON = 0.0001;
export const PICK_ESCALATE = 'escalate' as const;

export const LIKELIHOODS = getLikelihoodFactors();

export type LikelihoodConfig = typeof LIKELIHOODS;
export type TestPolarity = 'supports' | 'refutes' | 'neutral';
export type ObservationOutcome = 'normal' | 'abnormal' | 'resolved';

const PREFIX_PRIORITY: Record<string, number> = {
  OBS: 0,
  MES: 1,
  MAN: 2,
  DEM: 3,
  INT: 4,
  REM: 5,
  ESC: 6,
};

export function actionPrefixPriority(actionId: string): number {
  const prefix = actionId.split('-')[0] ?? '';
  return PREFIX_PRIORITY[prefix] ?? 99;
}

export function compareActionsTieBreak(a: string, b: string): number {
  const pa = actionPrefixPriority(a);
  const pb = actionPrefixPriority(b);
  if (pa !== pb) return pa - pb;
  return a.localeCompare(b);
}

export function entropy(hypotheses: HypothesisState[]): number {
  return hypotheses.reduce((e, h) => {
    if (h.prior <= 0) return e;
    return e - h.prior * Math.log2(h.prior);
  }, 0);
}

export function inferObservationOutcome(observation: string): ObservationOutcome {
  if (/disparait|disparaît|résolu|corrige|ne revient plus|efficace/i.test(observation)) {
    return 'resolved';
  }
  if (
    /anormal|hors plage|colmat|bouch|défaut|defaut|vide|aucun|pas de|insuffisant|encrass/i.test(
      observation,
    )
  ) {
    return 'abnormal';
  }
  if (/conforme|normal|dans la plage|stable|ok\b|rien d.anormal/i.test(observation)) {
    return 'normal';
  }
  return 'normal';
}

export function expectedEntropyAfterAction(
  hypotheses: HypothesisState[],
  actionId: string,
  hypothesisActions: Map<string, string[]>,
  likelihoods: LikelihoodConfig = LIKELIHOODS,
): number {
  const outcomes: ObservationOutcome[] = ['normal', 'abnormal'];
  let expected = 0;
  for (const outcome of outcomes) {
    const posterior = inferBayesFromObservation(
      hypotheses,
      actionId,
      '',
      hypothesisActions,
      outcome,
      likelihoods,
    );
    expected += 0.5 * entropy(posterior);
  }
  return expected;
}

/** EIG(action) = H(prior) − E[H(posterior)] (bits). */
export function computeActionEig(
  hypotheses: HypothesisState[],
  actionId: string,
  hypothesisActions: Map<string, string[]>,
  likelihoods: LikelihoodConfig = LIKELIHOODS,
): number {
  const base = entropy(hypotheses);
  const expected = expectedEntropyAfterAction(hypotheses, actionId, hypothesisActions, likelihoods);
  return Math.max(0, base - expected);
}

/** Masse a priori des causes liées à une action (contextuel par cas). */
export function priorMassForAction(
  hypotheses: HypothesisState[],
  actionId: string,
  hypothesisActions: Map<string, string[]>,
): number {
  return hypotheses
    .filter((h) => (hypothesisActions.get(h.id) ?? []).includes(actionId))
    .reduce((s, h) => s + h.prior, 0);
}

export function inferBayesFromObservation(
  hypotheses: HypothesisState[],
  actionId: string,
  observation: string,
  hypothesisActions: Map<string, string[]>,
  outcome?: ObservationOutcome,
  likelihoods: LikelihoodConfig = LIKELIHOODS,
): HypothesisState[] {
  const linked = hypotheses
    .filter((h) => (hypothesisActions.get(h.id) ?? []).includes(actionId))
    .map((h) => h.id);

  const derivedOutcome = outcome ?? inferObservationOutcome(observation);
  if (linked.length === 0 && derivedOutcome !== 'resolved') {
    return hypotheses;
  }

  const polarity: TestPolarity =
    derivedOutcome === 'resolved' || derivedOutcome === 'abnormal' ? 'supports' : 'refutes';

  return bayesUpdate(
    hypotheses,
    {
      action_id: actionId,
      observation,
      discriminates: linked,
      eliminates: [],
      resolves: derivedOutcome === 'resolved',
      polarity,
    },
    likelihoods,
  );
}

export function pickNextAction(
  hypotheses: HypothesisState[],
  availableActionIds: string[],
  actionCosts: Map<string, number>,
  executed: Set<string>,
  hypothesisActions?: Map<string, string[]>,
  _sessionSeed?: string,
  likelihoods: LikelihoodConfig = LIKELIHOODS,
): string | null {
  const sorted = [...hypotheses].sort((a, b) => b.prior - a.prior);
  const topIds = new Set(
    sorted.filter((h) => isConcludableHypothesis(h.id)).slice(0, 3).map((h) => h.id),
  );
  const preferred = new Set<string>();
  if (hypothesisActions) {
    for (const hid of topIds) {
      for (const aid of hypothesisActions.get(hid) ?? []) {
        preferred.add(aid);
      }
    }
  }

  let best: { id: string; score: number } | null = null;
  const baseEntropy = entropy(hypotheses);
  const candidates: Array<{ id: string; score: number }> = [];
  const useVoi = hypothesisActions && hypothesisActions.size > 0;

  for (const actionId of availableActionIds) {
    if (executed.has(actionId)) continue;
    const cost = actionCosts.get(actionId) ?? 50;
    let gain: number;
    if (useVoi && hypothesisActions) {
      const expectedH = expectedEntropyAfterAction(
        hypotheses,
        actionId,
        hypothesisActions,
        likelihoods,
      );
      gain = baseEntropy - expectedH;
      if (gain < VOI_MIN_GAIN_EPSILON) continue;
    } else {
      continue;
    }
    const score = useVoi
      ? gain - VOI_LAMBDA_COST_BITS_PER_EUR * cost
      : gain / (cost + 1);
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

export type VoiActionTrace = {
  action_id: string;
  raw_eig_bits: number;
  gain_before_fallback: number;
  gain_used: number;
  cost: number;
  engine_score: number;
  filtered_by_epsilon: boolean;
  preferred: boolean;
  uses_fallback_gain: boolean;
};

/** Trace le scoring réel de pickNextAction (≠ EIG brute de computeActionEig). */
export function traceVoiScoring(
  hypotheses: HypothesisState[],
  availableActionIds: string[],
  actionCosts: Map<string, number>,
  executed: Set<string>,
  hypothesisActions: Map<string, string[]>,
  likelihoods: LikelihoodConfig = LIKELIHOODS,
): VoiActionTrace[] {
  const sorted = [...hypotheses].sort((a, b) => b.prior - a.prior);
  const topIds = new Set(
    sorted.filter((h) => isConcludableHypothesis(h.id)).slice(0, 3).map((h) => h.id),
  );
  const preferred = new Set<string>();
  for (const hid of topIds) {
    for (const aid of hypothesisActions.get(hid) ?? []) preferred.add(aid);
  }

  const baseEntropy = entropy(hypotheses);
  const traces: VoiActionTrace[] = [];

  for (const actionId of availableActionIds) {
    if (executed.has(actionId)) continue;
    const cost = actionCosts.get(actionId) ?? 50;
    const expectedH = expectedEntropyAfterAction(
      hypotheses,
      actionId,
      hypothesisActions,
      likelihoods,
    );
    const gainBeforeFallback = baseEntropy - expectedH;
    const gain = gainBeforeFallback;
    const filtered = gain < VOI_MIN_GAIN_EPSILON;
    const engineScore = gain - VOI_LAMBDA_COST_BITS_PER_EUR * cost;
    traces.push({
      action_id: actionId,
      raw_eig_bits: Math.max(0, gainBeforeFallback),
      gain_before_fallback: gainBeforeFallback,
      gain_used: gain,
      cost,
      engine_score: engineScore,
      filtered_by_epsilon: filtered,
      preferred: preferred.has(actionId),
      uses_fallback_gain: false,
    });
  }

  return traces;
}

export function normalizePosterior(hypotheses: HypothesisState[]): HypothesisState[] {
  const sum = hypotheses.reduce((s, h) => s + h.prior, 0);
  if (sum <= 0) return hypotheses.map((h) => ({ ...h, prior: 1 / hypotheses.length }));
  return hypotheses.map((h) => ({ ...h, prior: h.prior / sum }));
}

export function bayesUpdate(
  hypotheses: HypothesisState[],
  test: CaseTest | undefined,
  likelihoods: LikelihoodConfig = LIKELIHOODS,
): HypothesisState[] {
  if (!test) return hypotheses;
  const polarity =
    test.polarity ??
    (/conforme|normal|dans la plage|stable|ok\b|rien d.anormal/i.test(test.observation) &&
    test.discriminates.length > 0
      ? 'refutes'
      : 'supports');
  const updated = hypotheses.map((h) => {
    let factor = 1;
    if (test.eliminates.includes(h.id)) factor = likelihoods.eliminate;
    else if (test.discriminates.includes(h.id)) {
      factor = polarity === 'refutes' ? likelihoods.refute : likelihoods.support;
    } else if (test.discriminates.length > 0) factor = likelihoods.unrelated;
    return { ...h, prior: Math.max(h.prior * factor, 1e-6) };
  });
  return normalizePosterior(updated);
}

export function buildTestFromMatrix(
  actionId: string,
  observation: string,
  hypothesisIds: string[],
  hypothesisActions: Map<string, string[]>,
): CaseTest {
  const resolves = /disparait|disparaît|résolu|corrige|ne revient plus|efficace/i.test(observation);
  const discriminates = hypothesisIds.filter((hid) =>
    (hypothesisActions.get(hid) ?? []).includes(actionId),
  );

  if (discriminates.length === 0 && !resolves) {
    return { action_id: actionId, observation, discriminates: [], eliminates: [] };
  }

  return {
    action_id: actionId,
    observation,
    discriminates: resolves ? discriminates : discriminates.slice(0, 3),
    eliminates: [],
    resolves,
  };
}

export function buildTestFromCaseAnnotation(
  actionId: string,
  observation: string,
  discriminates: string[],
  eliminates: string[],
  resolves?: boolean,
): CaseTest {
  return { action_id: actionId, observation, discriminates, eliminates, resolves };
}

export function shouldConclude(
  hypotheses: HypothesisState[],
  discriminantExecuted: boolean,
  conclusionThreshold?: number,
): { conclude: boolean; causeId: string | null } {
  const threshold = getConclusionThreshold(conclusionThreshold);
  const sorted = [...hypotheses]
    .filter((h) => isConcludableHypothesis(h.id))
    .sort((a, b) => b.prior - a.prior);
  const top = sorted[0];
  if (!top) return { conclude: false, causeId: null };
  if (discriminantExecuted && top.prior >= threshold) {
    return { conclude: true, causeId: top.id };
  }
  return { conclude: false, causeId: null };
}
