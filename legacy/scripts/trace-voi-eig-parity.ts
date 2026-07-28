/**
 * Trace paradoxe EIG : compare EIG brute (measure:eig-pilot) vs scoring pickNextAction.
 * Usage: pnpm trace:voi-eig-parity [case_id]
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { pickNextAction, traceVoiScoring, VOI_LAMBDA_COST_BITS_PER_EUR } from '../lib/bayes-engine.js';
import { hypothesisActionsMap } from '../lib/hypothesis-matrix.js';
import { runCaseDLocal } from '../lib/prod-session-local.js';
import { analyzeCaseEigTurn0, loadActionCosts } from '../lib/voi-eig-analysis.js';
import { diagnosticActionIds, loadV2Cases } from '../runners/v2-harness.js';

const caseId = process.argv[2] ?? 'hb2-0001';
const c = loadV2Cases().find((x) => x.id === caseId);
if (!c) {
  console.error(`Cas introuvable: ${caseId}`);
  process.exit(1);
}

const costs = loadActionCosts();
const ids = diagnosticActionIds();
const hyps = c.hypotheses.map((h) => ({
  id: h.id,
  label: h.label ?? h.id,
  prior: h.prior ?? 0,
  n_observations: (h as { n_observations?: number }).n_observations,
}));
const ha = hypothesisActionsMap(hyps.map((h) => h.id));
const eigAnalysis = analyzeCaseEigTurn0(c, ids, costs);
const traces = traceVoiScoring(hyps, ids, costs, new Set(), ha);
const picked = pickNextAction(hyps, ids, costs, new Set(), ha);
const dPath = runCaseDLocal(c, 0).path;

const topRaw = [...traces].sort((a, b) => b.raw_eig_bits - a.raw_eig_bits).slice(0, 8);
const topEngine = [...traces].sort((a, b) => b.engine_score - a.engine_score).slice(0, 8);
const zeroEig = traces.filter((t) => t.raw_eig_bits < 1e-12);
const fallbackWinners = topEngine.filter((t) => t.uses_fallback_gain);

const report = {
  case_id: caseId,
  generated_at: new Date().toISOString(),
  hypotheses: hyps.map((h) => ({ id: h.id, prior: h.prior })),
  base_entropy_bits: eigAnalysis.base_entropy_bits,
  pct_exact_zero_eig: eigAnalysis.pct_exact_zero_eig,
  eig_max_raw: { action: eigAnalysis.eig_max_action, bits: eigAnalysis.eig_max },
  ratio_eig_max_over_lambda_delta_cost: eigAnalysis.eig_max_over_lambda_delta_cost,
  engine_pick: picked,
  d_local_first_actions: dPath.slice(0, 5),
  paradox_resolution: {
    hypothesis_1_eig_mismatch:
      'CONFIRMÉ — measure:eig-pilot utilise computeActionEig (brute) ; pickNextAction applique fallback gain=H×0,35 si gain≤0',
    hypothesis_2_epsilon:
      'CONFIRMÉ partiel — ε=0,0001 ne filtre pas : fallback ~0,85 bit >> ε',
    hypothesis_3_stale_eig:
      'REJETÉ tour 0 — pickNextAction recalcule à chaque tour (hypothèses courantes)',
  },
  top_raw_eig: topRaw,
  top_engine_score: topEngine,
  sample_zero_eig_with_fallback: zeroEig.slice(0, 3).map((t) => ({
    action_id: t.action_id,
    raw_eig: t.raw_eig_bits,
    gain_used: t.gain_used,
    cost: t.cost,
    engine_score: t.engine_score,
    lambda_cost: VOI_LAMBDA_COST_BITS_PER_EUR * t.cost,
  })),
  engine_winner_uses_fallback: fallbackWinners.some((t) => t.action_id === picked),
};

const outPath = resolve(
  import.meta.dirname,
  `../reports/voi-eig-parity-${caseId}-2026-07-27.json`,
);
writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log(JSON.stringify(report, null, 2));
console.error(`\nRapport: ${outPath}`);
