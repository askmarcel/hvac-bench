import assert from 'node:assert/strict';
import { test } from 'node:test';

import { initialHypothesesV3 } from '../../lib/v3/candidates.js';
import { computeActionEigV3 } from '../../lib/v3/eig-v3.js';
import { resetKnowledgeCache } from '../../lib/v3/knowledge-loader.js';
import { diagnosticActionIdsV3 } from '../../lib/v3/hypothesis-actions.js';

test('eig-v3 — MES-DT-EAU non nulle avec arbre branché', () => {
  resetKnowledgeCache();
  const hyps = initialHypothesesV3('pac_air_eau', '7H');
  const eig = computeActionEigV3(hyps, 'MES-DT-EAU', {
    equipment_type: 'pac_air_eau',
    emitter: 'plancher_chauffant',
  });
  assert.ok(eig > 0, `EIG attendue > 0, reçu ${eig}`);
});

test('eig-v3 — échec synthétique matrice vide (action sans grandeur)', () => {
  resetKnowledgeCache();
  const hyps = initialHypothesesV3('pac_air_eau', '7H');
  const eig = computeActionEigV3(hyps, 'ACTION-SANS-MAP', {
    equipment_type: 'pac_air_eau',
  });
  assert.equal(eig, 0);
});

test('eig-v3 — au moins une action candidate a EIG > 0', () => {
  resetKnowledgeCache();
  const hyps = initialHypothesesV3('pac_air_eau', '7H');
  const actions = diagnosticActionIdsV3();
  const anyPositive = actions.some(
    (a) =>
      computeActionEigV3(hyps, a, { equipment_type: 'pac_air_eau' }) > 1e-12,
  );
  assert.ok(anyPositive);
});
