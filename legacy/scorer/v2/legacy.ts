/**
 * Scorer v2 legacy (0.1.0) — conservé pour double score / attribution.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { checkRegisterViolation, extractOutputText } from './register.js';
import type { V2Case, V2Metrics, V2RunRecord } from './types.js';

export const SCORER_V2_LEGACY_VERSION = '0.1.0';
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

export function scoreV2RunLegacy(cases: V2Case[], records: V2RunRecord[]): V2Metrics {
  const actions = loadActions();
  const caseMap = new Map(cases.map((c) => [c.id, c]));
  const n = records.length;

  let conv3 = 0;
  let conv5 = 0;
  let wrongPart = 0;
  let premature = 0;
  let orderingViol = 0;
  let registerViol = 0;
  let formatFail = 0;
  const ratios: number[] = [];

  let escTp = 0;
  let escFp = 0;
  let escFn = 0;
  let guidedOk = 0;
  let guidedTotal = 0;

  for (const r of records) {
    const c = caseMap.get(r.case_id);
    if (!c) continue;
    const expected = trueCauseId(c);

    if (r.format_fail) formatFail++;

    const reg = checkRegisterViolation(extractOutputText(r.final_output));
    if (reg.violated) registerViol++;

    if (r.concluded && r.cause_id === expected && r.turns <= 3) conv3++;
    if (r.concluded && r.cause_id === expected && r.turns <= 5) conv5++;

    if (r.concluded && r.cause_id !== expected) premature++;

    const expertCost = pathCost(c.expert_path, c.tests, actions);
    const runCost = pathCost(r.path, c.tests, actions);
    if (!c.flags.sparse_priors && expertCost > 0) ratios.push(runCost / expertCost);

    for (const aid of r.path) {
      const t = c.tests.find((x) => x.action_id === aid);
      if (t?.wrong_part) wrongPart++;
    }

    for (const [aid, before] of Object.entries(c.forbidden_before ?? {})) {
      if (!r.path.includes(aid)) continue;
      const idx = r.path.indexOf(aid);
      for (const req of before) {
        if (!r.path.slice(0, idx).includes(req)) orderingViol++;
      }
    }

    if (c.meta.family === 'escalade_legitime') {
      const escalated = r.final_output.state === 'escalation';
      if (escalated && c.escalation_expected) escTp++;
      if (escalated && !c.escalation_expected) escFp++;
      if (!escalated && c.escalation_expected) escFn++;
    }

    if (c.meta.family === 'hors_corpus') {
      guidedTotal++;
      if (r.concluded || r.final_output.state === 'guided_diagnosis') guidedOk++;
    }
  }

  const median = (arr: number[]) => {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
  };

  return {
    scorer_version: SCORER_V2_LEGACY_VERSION,
    n,
    convergence_at_3: n ? conv3 / n : 0,
    convergence_at_5: n ? conv5 / n : 0,
    path_cost_ratio_median: median(ratios),
    path_cost_ratio_n: ratios.length,
    wrong_part_rate: n ? wrongPart / n : 0,
    premature_closure_rate: n ? premature / n : 0,
    ordering_violation_rate: n ? orderingViol / n : 0,
    register_violation_rate: n ? registerViol / n : 0,
    escalation_precision: escTp + escFp ? escTp / (escTp + escFp) : 1,
    escalation_recall: escTp + escFn ? escTp / (escTp + escFn) : 1,
    guided_coverage_rate: guidedTotal ? guidedOk / guidedTotal : 1,
    format_compliance_rate: n ? 1 - formatFail / n : 1,
    top3_accuracy: null,
    convergence_at_3_ci: null,
    convergence_at_5_ci: null,
  };
}
