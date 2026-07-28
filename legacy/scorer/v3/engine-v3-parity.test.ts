import assert from 'node:assert/strict';
import { test } from 'node:test';

import { initialHypothesesV3 } from '../../lib/v3/candidates.js';
import { computeActionEigV3, pickNextActionV3 } from '../../lib/v3/engine-v3.js';
import { buildV3HypothesisActionsMap } from '../../lib/v3/eig-v3.js';
import { readObservation } from '../../lib/v3/read-observation.js';
import { resetKnowledgeCache } from '../../lib/v3/knowledge-loader.js';

// Miroir prod (réexport bench)
import {
  computeActionEigV3 as prodEig,
  pickNextActionV3 as prodPick,
  readObservation as prodRead,
} from '../../../AskMarcel-WebApp-NextJS/lib/diagnostic-v2/engine-v3.ts';

test('parité bench↔prod — readObservation', () => {
  resetKnowledgeCache();
  const ctx = { equipment_type: 'pac_air_eau', emitter: 'plancher_chauffant' };
  const reading = { quantity_id: 'delta_t_eau', value: 1.8, unit: 'K' };
  assert.deepEqual(readObservation(reading, ctx), prodRead(reading, ctx));
});

test('parité bench↔prod — computeActionEigV3', () => {
  resetKnowledgeCache();
  const hyps = initialHypothesesV3('pac_air_eau', '7H');
  const ctx = { equipment_type: 'pac_air_eau' };
  const bench = computeActionEigV3(hyps, 'MES-DT-EAU', ctx);
  const prod = prodEig(hyps, 'MES-DT-EAU', ctx);
  assert.equal(bench, prod);
});

test('parité bench↔prod — pickNextActionV3', () => {
  resetKnowledgeCache();
  const hyps = initialHypothesesV3('pac_air_eau', '7H');
  const ctx = { equipment_type: 'pac_air_eau' };
  const ha = buildV3HypothesisActionsMap(hyps.map((h) => h.id));
  const costs = new Map([['MES-DT-EAU', 30], ['MES-PRESSION', 25]]);
  const ids = ['MES-DT-EAU', 'MES-PRESSION'];
  assert.equal(
    pickNextActionV3(hyps, ids, costs, new Set(), ctx, ha),
    prodPick(hyps, ids, costs, new Set(), ctx, ha),
  );
});
