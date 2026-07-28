/**
 * H2 — règle contrefactuelle hb2-0005.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { initialHypothesesV3 } from '../../lib/v3/candidates.js';
import { updatePosteriorV3 } from '../../lib/v3/bayes-update-v3.js';
import { counterfactualOverlay } from '../../lib/v3/counterfactual.js';
import { resetKnowledgeCache } from '../../lib/v3/knowledge-loader.js';
import { getV3CaseById } from '../../runners/v3-harness.js';

function priorOf(hypotheses: { id: string; prior: number }[], id: string): number {
  return hypotheses.find((h) => h.id === id)?.prior ?? 0;
}

test('H2 hb2-0005 — MAN-REMPLISSAGE confirme pression_basse', () => {
  resetKnowledgeCache();
  const c = getV3CaseById('hb2-0005');
  assert.ok(c);
  let hyps = initialHypothesesV3('pac_air_eau', c!.symptom.code_present);
  const before = priorOf(hyps, 'pression_basse');

  const remplissage = c!.observations.find((o) => o.action_id === 'MAN-REMPLISSAGE');
  assert.ok(remplissage);
  hyps = updatePosteriorV3(hyps, remplissage!, c!.context);
  const after = priorOf(hyps, 'pression_basse');
  assert.ok(after > before, `pression_basse ${before} → ${after}`);
});

test('H2 hb2-0005 — REM-FLOWSWITCH wrong_part refute flowswitch_hs', () => {
  resetKnowledgeCache();
  const c = getV3CaseById('hb2-0005');
  assert.ok(c);
  let hyps = initialHypothesesV3('pac_air_eau', c!.symptom.code_present);

  const flowswitch = c!.observations.find((o) => o.action_id === 'REM-FLOWSWITCH');
  assert.ok(flowswitch);
  assert.equal(flowswitch!.wrong_part, true);

  const before = priorOf(hyps, 'flowswitch_hs');
  hyps = updatePosteriorV3(hyps, flowswitch!, c!.context);
  const after = priorOf(hyps, 'flowswitch_hs');
  assert.ok(after < before, `flowswitch_hs ${before} → ${after}`);
});

test('H2 échec synthétique — wrong_part sans cible repair (overlay vide)', () => {
  resetKnowledgeCache();
  const overlay = counterfactualOverlay(
    {
      action_id: 'REM-INEXISTANT',
      reading: { quantity_id: 'debit_l_min', value: 22, unit: 'l/min' },
      wrong_part: true,
    },
    { equipment_type: 'pac_air_eau' },
  );
  assert.equal(overlay.size, 0);
});
