/**
 * Analyse EIG / masse a priori par action — tour 0, priors pilote.
 * Le bon axe n'est pas le compte de causes mais la variance d'EIG et la masse ~0,5.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  computeActionEig,
  entropy,
  pickNextAction,
  priorMassForAction,
  traceVoiScoring,
  VOI_LAMBDA_COST_BITS_PER_EUR,
  type HypothesisState,
} from './bayes-engine.js';
import { hypothesisActionsMap } from './hypothesis-matrix.js';
import { initialHypothesesV3 } from './v3/candidates.js';
import {
  buildV3HypothesisActionsMap,
  computeActionEigV3,
} from './v3/eig-v3.js';
import { pickNextActionV3 } from './v3/engine-v3.js';
import { diagnosticActionIdsV3 } from './v3/hypothesis-actions.js';
import type { V3Case } from './v3/types.js';
import type { PilotCaseExtended } from '../runners/v2-harness.js';

const LAMBDA_INVASIVENESS = 25;
const PRIOR_MASS_USELESS = 0.6;
/** EIG considérée nulle (recouvrement action×cause absent). */
export const ZERO_EIG_EPSILON = 1e-12;

export function loadActionCosts(): Map<string, number> {
  const path = resolve(import.meta.dirname, '../taxonomy/actions-v2.json');
  const file = JSON.parse(readFileSync(path, 'utf8')) as {
    actions: Array<{ action_id: string; cost_eur_default: number; invasiveness: number }>;
  };
  return new Map(
    file.actions.map((a) => [
      a.action_id,
      a.cost_eur_default + LAMBDA_INVASIVENESS * a.invasiveness,
    ]),
  );
}

export type ActionEigRow = {
  action_id: string;
  eig_bits: number;
  prior_mass: number;
  cost: number;
  voi_score: number;
};

export type CaseEigAnalysis = {
  case_id: string;
  base_entropy_bits: number;
  n_actions: number;
  eig_median: number;
  eig_std: number;
  eig_max: number;
  eig_min: number;
  pct_exact_zero_eig: number;
  eig_max_action: string;
  engine_pick_action: string | null;
  engine_top_score: number;
  cheapest_action: string;
  cheapest_cost: number;
  eig_max_cost: number;
  lambda_delta_cost: number;
  /** Ratio basé sur EIG brute — ne prédit pas pickNextAction si fallback gain actif. */
  eig_max_over_lambda_delta_cost: number | null;
  useless_mass_actions: string[];
  actions: ActionEigRow[];
};

function stdDev(nums: number[]): number {
  if (nums.length < 2) return 0;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const v = nums.reduce((s, x) => s + (x - mean) ** 2, 0) / nums.length;
  return Math.sqrt(v);
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export function analyzeCaseEigTurn0(
  c: PilotCaseExtended,
  candidateActionIds: string[],
  actionCosts: Map<string, number>,
): CaseEigAnalysis {
  const hypotheses: HypothesisState[] = c.hypotheses.map((h) => ({
    id: h.id,
    label: h.label ?? h.id,
    prior: h.prior ?? 1 / c.hypotheses.length,
    n_observations: (h as { n_observations?: number }).n_observations,
  }));
  const hypothesisActions = hypothesisActionsMap(hypotheses.map((h) => h.id));
  const base_entropy_bits = entropy(hypotheses);

  const actions: ActionEigRow[] = candidateActionIds.map((action_id) => {
    const eig_bits = computeActionEig(hypotheses, action_id, hypothesisActions);
    const prior_mass = priorMassForAction(hypotheses, action_id, hypothesisActions);
    const cost = actionCosts.get(action_id) ?? 50;
    const voi_score = eig_bits - VOI_LAMBDA_COST_BITS_PER_EUR * cost;
    return { action_id, eig_bits, prior_mass, cost, voi_score };
  });

  const eigValues = actions.map((a) => a.eig_bits);
  const zeroEigCount = eigValues.filter((e) => e < ZERO_EIG_EPSILON).length;
  const eig_max_row = [...actions].sort((a, b) => b.eig_bits - a.eig_bits)[0]!;
  const cheapest = [...actions].sort((a, b) => a.cost - b.cost)[0]!;
  const lambda_delta_cost = eig_max_row.cost - cheapest.cost;
  const eig_max_over_lambda_delta_cost =
    lambda_delta_cost > 0
      ? eig_max_row.eig_bits / (VOI_LAMBDA_COST_BITS_PER_EUR * lambda_delta_cost)
      : null;

  const engineTraces = traceVoiScoring(
    hypotheses,
    candidateActionIds,
    actionCosts,
    new Set(),
    hypothesisActions,
  );
  const engineTop = [...engineTraces].sort((a, b) => b.engine_score - a.engine_score)[0];
  const engine_pick_action = pickNextAction(
    hypotheses,
    candidateActionIds,
    actionCosts,
    new Set(),
    hypothesisActions,
  );

  return {
    case_id: c.id,
    base_entropy_bits,
    n_actions: actions.length,
    eig_median: median(eigValues),
    eig_std: stdDev(eigValues),
    eig_max: eig_max_row.eig_bits,
    eig_min: Math.min(...eigValues),
    pct_exact_zero_eig: actions.length ? zeroEigCount / actions.length : 0,
    eig_max_action: eig_max_row.action_id,
    engine_pick_action,
    engine_top_score: engineTop?.engine_score ?? 0,
    cheapest_action: cheapest.action_id,
    cheapest_cost: cheapest.cost,
    eig_max_cost: eig_max_row.cost,
    lambda_delta_cost,
    eig_max_over_lambda_delta_cost,
    useless_mass_actions: actions
      .filter((a) => a.prior_mass > PRIOR_MASS_USELESS)
      .map((a) => a.action_id),
    actions: actions.sort((a, b) => b.eig_bits - a.eig_bits),
  };
}

export type PilotEigReport = {
  generated_at: string;
  n_cases: number;
  prior_mass_useless_threshold: number;
  pooled_eig: {
    median: number;
    std: number;
    n_samples: number;
    pct_exact_zero: number;
  };
  per_case_median_eig_std: number;
  per_case_median_eig_max_over_lambda_delta: number | null;
  cases: CaseEigAnalysis[];
  top_eig_actions_pooled: Array<{ action_id: string; mean_eig: number; n_cases: number }>;
  diagnosis: string;
};

export function analyzePilotEig(
  cases: PilotCaseExtended[],
  candidateActionIds: string[],
): PilotEigReport {
  const costs = loadActionCosts();
  const caseAnalyses = cases.map((c) => analyzeCaseEigTurn0(c, candidateActionIds, costs));
  const pooledEigs = caseAnalyses.flatMap((ca) => ca.actions.map((a) => a.eig_bits));
  const caseStd = caseAnalyses.map((c) => c.eig_std);
  const ratios = caseAnalyses
    .map((c) => c.eig_max_over_lambda_delta_cost)
    .filter((r): r is number => r != null);

  const byAction = new Map<string, number[]>();
  for (const ca of caseAnalyses) {
    for (const a of ca.actions) {
      const list = byAction.get(a.action_id) ?? [];
      list.push(a.eig_bits);
      byAction.set(a.action_id, list);
    }
  }
  const top_eig_actions_pooled = [...byAction.entries()]
    .map(([action_id, eigs]) => ({
      action_id,
      mean_eig: eigs.reduce((s, x) => s + x, 0) / eigs.length,
      n_cases: eigs.length,
    }))
    .sort((a, b) => b.mean_eig - a.mean_eig)
    .slice(0, 15);

  const pooledStd = stdDev(pooledEigs);
  const pooledZeroPct = pooledEigs.filter((e) => e < ZERO_EIG_EPSILON).length / pooledEigs.length;
  let diagnosis =
    'EIG plat — VOI dégénère en minimiseur de coût ; élargir actions vers ~50 % masse a priori.';
  if (pooledStd > 0.15) {
    diagnosis = 'Variance EIG non nulle — vérifier si λ écrase le signal (ratio EIG_max/λΔcost).';
  }
  if (pooledZeroPct > MAX_PCT_EXACT_ZERO_EIG) {
    diagnosis =
      'Recouvrement action×cause faible — majorité EIG=0 ; fallback gain pickNextAction peut dominer le coût.';
  }

  return {
    generated_at: new Date().toISOString(),
    n_cases: cases.length,
    prior_mass_useless_threshold: PRIOR_MASS_USELESS,
    pooled_eig: {
      median: median(pooledEigs),
      std: pooledStd,
      n_samples: pooledEigs.length,
      pct_exact_zero: pooledZeroPct,
    },
    per_case_median_eig_std: median(caseStd),
    per_case_median_eig_max_over_lambda_delta: ratios.length ? median(ratios) : null,
    cases: caseAnalyses,
    top_eig_actions_pooled,
    diagnosis,
  };
}

/** Garde-fou : variance EIG et médiane poolée — éviter VOI = minimiseur de coût. */
export const MIN_POOLED_EIG_STDDEV = 0.08;
export const MIN_POOLED_EIG_MEDIAN = 0.05;
/** Au-delà : recouvrement action×cause insuffisant (actions inertes). */
export const MAX_PCT_EXACT_ZERO_EIG = 0.5;

export function eigVarianceGuard(report: PilotEigReport): {
  ok: boolean;
  pooled_std: number;
  pooled_median: number;
  threshold_std: number;
  threshold_median: number;
} {
  return {
    ok:
      report.pooled_eig.std >= MIN_POOLED_EIG_STDDEV &&
      report.pooled_eig.median >= MIN_POOLED_EIG_MEDIAN,
    pooled_std: report.pooled_eig.std,
    pooled_median: report.pooled_eig.median,
    threshold_std: MIN_POOLED_EIG_STDDEV,
    threshold_median: MIN_POOLED_EIG_MEDIAN,
  };
}

export function eigZeroCoverageGuard(report: PilotEigReport): {
  ok: boolean;
  pct_exact_zero: number;
  threshold_max: number;
} {
  return {
    ok: report.pooled_eig.pct_exact_zero <= MAX_PCT_EXACT_ZERO_EIG,
    pct_exact_zero: report.pooled_eig.pct_exact_zero,
    threshold_max: MAX_PCT_EXACT_ZERO_EIG,
  };
}

/** Seuil H1 P1 — polarité calculée v3. */
export const H1_MAX_PCT_EXACT_ZERO_EIG = 0.3;

export function analyzeCaseEigTurn0V3(
  c: V3Case,
  candidateActionIds: string[],
  actionCosts: Map<string, number>,
): CaseEigAnalysis {
  const hypotheses = initialHypothesesV3('pac_air_eau', c.symptom.code_present);
  const hypothesisActions = buildV3HypothesisActionsMap(hypotheses.map((h) => h.id));
  const base_entropy_bits = entropy(hypotheses);

  const actions: ActionEigRow[] = candidateActionIds.map((action_id) => {
    const eig_bits = computeActionEigV3(hypotheses, action_id, c.context);
    const prior_mass = priorMassForAction(hypotheses, action_id, hypothesisActions);
    const cost = actionCosts.get(action_id) ?? 50;
    const voi_score = eig_bits - VOI_LAMBDA_COST_BITS_PER_EUR * cost;
    return { action_id, eig_bits, prior_mass, cost, voi_score };
  });

  const eigValues = actions.map((a) => a.eig_bits);
  const zeroEigCount = eigValues.filter((e) => e < ZERO_EIG_EPSILON).length;
  const eig_max_row = [...actions].sort((a, b) => b.eig_bits - a.eig_bits)[0]!;
  const cheapest = [...actions].sort((a, b) => a.cost - b.cost)[0]!;
  const lambda_delta_cost = eig_max_row.cost - cheapest.cost;
  const eig_max_over_lambda_delta_cost =
    lambda_delta_cost > 0
      ? eig_max_row.eig_bits / (VOI_LAMBDA_COST_BITS_PER_EUR * lambda_delta_cost)
      : null;

  const engine_pick_action = pickNextActionV3(
    hypotheses,
    candidateActionIds,
    actionCosts,
    new Set(),
    c.context,
    hypothesisActions,
  );

  const engineTop = [...actions].sort((a, b) => b.voi_score - a.voi_score)[0];

  return {
    case_id: c.id,
    base_entropy_bits,
    n_actions: actions.length,
    eig_median: median(eigValues),
    eig_std: stdDev(eigValues),
    eig_max: eig_max_row.eig_bits,
    eig_min: Math.min(...eigValues),
    pct_exact_zero_eig: actions.length ? zeroEigCount / actions.length : 0,
    eig_max_action: eig_max_row.action_id,
    engine_pick_action,
    engine_top_score: engineTop?.voi_score ?? 0,
    cheapest_action: cheapest.action_id,
    cheapest_cost: cheapest.cost,
    eig_max_cost: eig_max_row.cost,
    lambda_delta_cost,
    eig_max_over_lambda_delta_cost,
    useless_mass_actions: actions
      .filter((a) => a.prior_mass > PRIOR_MASS_USELESS)
      .map((a) => a.action_id),
    actions: actions.sort((a, b) => b.eig_bits - a.eig_bits),
  };
}

export function analyzePilotEigV3(cases: V3Case[]): PilotEigReport {
  const candidates = diagnosticActionIdsV3();
  const costs = loadActionCosts();
  const caseAnalyses = cases.map((c) => analyzeCaseEigTurn0V3(c, candidates, costs));
  const pooledEigs = caseAnalyses.flatMap((ca) => ca.actions.map((a) => a.eig_bits));
  const caseStd = caseAnalyses.map((c) => c.eig_std);
  const ratios = caseAnalyses
    .map((c) => c.eig_max_over_lambda_delta_cost)
    .filter((r): r is number => r != null);

  const byAction = new Map<string, number[]>();
  for (const ca of caseAnalyses) {
    for (const a of ca.actions) {
      const list = byAction.get(a.action_id) ?? [];
      list.push(a.eig_bits);
      byAction.set(a.action_id, list);
    }
  }
  const top_eig_actions_pooled = [...byAction.entries()]
    .map(([action_id, eigs]) => ({
      action_id,
      mean_eig: eigs.reduce((s, x) => s + x, 0) / eigs.length,
      n_cases: eigs.length,
    }))
    .sort((a, b) => b.mean_eig - a.mean_eig)
    .slice(0, 15);

  const pooledStd = stdDev(pooledEigs);
  const pooledZeroPct = pooledEigs.filter((e) => e < ZERO_EIG_EPSILON).length / pooledEigs.length;
  let diagnosis = 'EIG v3 — polarité calculée active.';
  if (pooledZeroPct > H1_MAX_PCT_EXACT_ZERO_EIG) {
    diagnosis = `H1 FAIL — pct_exact_zero ${(pooledZeroPct * 100).toFixed(1)} % > ${H1_MAX_PCT_EXACT_ZERO_EIG * 100} %`;
  } else if (median(pooledEigs) > 0) {
    diagnosis = `H1 PASS — médiane EIG ${median(pooledEigs).toFixed(4)} bit, pct_zero ${(pooledZeroPct * 100).toFixed(1)} %`;
  }

  return {
    generated_at: new Date().toISOString(),
    n_cases: cases.length,
    prior_mass_useless_threshold: PRIOR_MASS_USELESS,
    pooled_eig: {
      median: median(pooledEigs),
      std: pooledStd,
      n_samples: pooledEigs.length,
      pct_exact_zero: pooledZeroPct,
    },
    per_case_median_eig_std: median(caseStd),
    per_case_median_eig_max_over_lambda_delta: ratios.length ? median(ratios) : null,
    cases: caseAnalyses,
    top_eig_actions_pooled,
    diagnosis,
  };
}

export function eigZeroCoverageGuardV3(report: PilotEigReport): {
  ok: boolean;
  pct_exact_zero: number;
  threshold_max: number;
} {
  return {
    ok: report.pooled_eig.pct_exact_zero <= H1_MAX_PCT_EXACT_ZERO_EIG,
    pct_exact_zero: report.pooled_eig.pct_exact_zero,
    threshold_max: H1_MAX_PCT_EXACT_ZERO_EIG,
  };
}
