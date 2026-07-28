/**
 * Scorer v2 — métriques déterministes diagnostic différentiel (CDC §8)
 * Version 0.3.0 — audit instrumentation S1 2026-07-26
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { scoreV2RunLegacy } from './legacy.js';
import { aggregateOracleMetrics } from './oracle-metrics.js';
import { computeDirectionalMetrics } from './directional-metrics.js';
import { checkRegisterViolation, extractOutputText } from './register.js';
import { wilsonCI, isCaseSuccess } from './stats.js';
import type { V2Case, V2Metrics, V2RunRecord } from './types.js';

export const SCORER_V2_VERSION = '0.3.0';
export { SCORER_V2_LEGACY_VERSION, scoreV2RunLegacy } from './legacy.js';
export * from './stats.js';
export type { V2Case, V2Metrics, V2RunRecord, WilsonCI } from './types.js';

export const LAMBDA = 25;

type DiagAction = {
  action_id: string;
  invasiveness: number;
  cost_eur: number;
};

function actionCost(action: DiagAction, lambda = LAMBDA): number {
  return action.cost_eur + lambda * action.invasiveness;
}

function trueCauseId(c: V2Case): string {
  return c.hypotheses.find((h) => h.true_cause)!.id;
}

function isConvergedSuccess(c: V2Case, r: V2RunRecord): boolean {
  return isCaseSuccess(c, r);
}

function pathCost(
  path: string[],
  tests: V2Case['tests'],
  actions: Map<string, DiagAction>,
): number {
  const testMap = new Map(tests.map((t) => [t.action_id, t]));
  return path.reduce((sum, aid) => {
    const t = testMap.get(aid);
    const a = actions.get(aid);
    if (t?.cost_eur != null) return sum + t.cost_eur + LAMBDA * (a?.invasiveness ?? 2);
    if (a) return sum + actionCost(a, LAMBDA);
    return sum + 50;
  }, 0);
}

function loadActions(): Map<string, DiagAction> {
  const path = resolve(import.meta.dirname, '../../taxonomy/actions-v2.json');
  const file = JSON.parse(readFileSync(path, 'utf8')) as {
    actions: Array<{
      action_id: string;
      invasiveness: number;
      cost_eur_default: number;
    }>;
  };
  return new Map(
    file.actions.map((a) => [
      a.action_id,
      { action_id: a.action_id, invasiveness: a.invasiveness, cost_eur: a.cost_eur_default },
    ]),
  );
}

function median(arr: number[]): number | null {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function top3Hit(r: V2RunRecord, expected: string): boolean {
  const ranked = r.hypotheses_final ?? (r.final_output.hypotheses_ranked as Array<{ id: string }> | undefined);
  if (!ranked?.length) return r.concluded && r.cause_id === expected;
  const top3 = [...ranked]
    .sort((a, b) => ((b as { prior?: number }).prior ?? 0) - ((a as { prior?: number }).prior ?? 0))
    .slice(0, 3)
    .map((h) => h.id);
  return top3.includes(expected);
}

export function scoreV2Run(cases: V2Case[], records: V2RunRecord[]): V2Metrics {
  const actions = loadActions();
  const caseMap = new Map(cases.map((c) => [c.id, c]));
  const n = records.length;

  let conv3 = 0;
  let conv5 = 0;
  let prematureNum = 0;
  let prematureDen = 0;
  let orderingViol = 0;
  let registerViol = 0;
  let formatFail = 0;
  const ratios: number[] = [];

  let escTp = 0;
  let escFp = 0;
  let escFn = 0;
  let guidedOk = 0;
  let guidedTotal = 0;
  let top3 = 0;

  for (const r of records) {
    const c = caseMap.get(r.case_id);
    if (!c) continue;
    const expected = trueCauseId(c);

    if (r.format_fail) formatFail++;

    const reg = checkRegisterViolation(extractOutputText(r.final_output));
    if (reg.violated) registerViol++;

    if (isConvergedSuccess(c, r) && r.turns <= 3) conv3++;
    if (isConvergedSuccess(c, r) && r.turns <= 5) conv5++;

    if (r.concluded) {
      prematureDen++;
      if (r.cause_id !== expected) prematureNum++;
    }

    if (top3Hit(r, expected)) top3++;

    const expertCost = pathCost(c.expert_path, c.tests, actions);
    const runCost = pathCost(r.path, c.tests, actions);
    const convergedOk = isConvergedSuccess(c, r);
    if (convergedOk && expertCost > 0) ratios.push(runCost / expertCost);

    for (const [aid, before] of Object.entries(c.forbidden_before ?? {})) {
      if (!r.path.includes(aid)) continue;
      const idx = r.path.indexOf(aid);
      for (const req of before) {
        if (!r.path.slice(0, idx).includes(req)) orderingViol++;
      }
    }

    const escalated = r.final_output.state === 'escalation';
    if (c.meta.family === 'escalade_legitime') {
      if (escalated && c.escalation_expected) escTp++;
      if (!escalated && c.escalation_expected) escFn++;
    } else if (escalated) {
      escFp++;
    }

    if (c.meta.family === 'hors_corpus') {
      guidedTotal++;
      if (r.concluded || r.final_output.state === 'guided_diagnosis') guidedOk++;
    }
  }

  const ratioMedian = ratios.length >= 10 ? median(ratios) : null;
  const oracle = aggregateOracleMetrics(cases, records);
  const directional = computeDirectionalMetrics(cases, records);

  return {
    scorer_version: SCORER_V2_VERSION,
    n,
    convergence_at_3: n ? conv3 / n : 0,
    convergence_at_5: n ? conv5 / n : 0,
    path_cost_ratio_median: ratioMedian,
    path_cost_ratio_n: ratios.length,
    wrong_part_rate: n ? oracle.wrong_part_rate : null,
    premature_closure_rate: prematureDen ? prematureNum / prematureDen : null,
    ordering_violation_rate: n ? orderingViol / n : 0,
    register_violation_rate: n ? registerViol / n : 0,
    escalation_precision: escTp + escFp ? escTp / (escTp + escFp) : 1,
    escalation_recall: escTp + escFn ? escTp / (escTp + escFn) : 1,
    guided_coverage_rate: guidedTotal ? guidedOk / guidedTotal : 1,
    format_compliance_rate: n ? 1 - formatFail / n : 1,
    top3_accuracy: n ? top3 / n : null,
    convergence_at_3_ci: wilsonCI(conv3, n),
    convergence_at_5_ci: wilsonCI(conv5, n),
    expert_path_first_hit_rate: oracle.expert_path_first_hit_rate,
    invasive_wrong_first_rate: oracle.invasive_wrong_first_rate,
    median_delta_log_odds: directional.median_delta_log_odds,
    mean_true_cause_rank_final: directional.mean_true_cause_rank_final,
  };
}

/** Double score : legacy + corrigé. */
export function scoreV2RunDual(
  cases: V2Case[],
  records: V2RunRecord[],
): { current: V2Metrics; legacy: V2Metrics } {
  return {
    current: scoreV2Run(cases, records),
    legacy: scoreV2RunLegacy(cases, records),
  };
}
