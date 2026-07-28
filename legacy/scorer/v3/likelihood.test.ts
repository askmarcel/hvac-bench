import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resetKnowledgeCache } from '../../lib/v3/knowledge-loader.js';
import { likelihoodFactor } from '../../lib/v3/likelihood.js';

test('likelihood — direction high + band above → LR fort (10)', () => {
  resetKnowledgeCache();
  const factor = likelihoodFactor('air_circuit', {
    kind: 'numeric',
    quantity_id: 'delta_t_eau',
    band: 'above',
  });
  assert.equal(factor, 10);
});

test('likelihood — direction high + band below → 1/LR', () => {
  resetKnowledgeCache();
  const factor = likelihoodFactor('air_circuit', {
    kind: 'numeric',
    quantity_id: 'delta_t_eau',
    band: 'below',
  });
  assert.ok(Math.abs(factor - 0.1) < 1e-9);
});

test('likelihood — cause sans effet sur grandeur → 1.0', () => {
  resetKnowledgeCache();
  const factor = likelihoodFactor('carte_hs', {
    kind: 'numeric',
    quantity_id: 'delta_t_eau',
    band: 'above',
  });
  assert.equal(factor, 1);
});

test('likelihood — échec synthétique direction inversée', () => {
  resetKnowledgeCache();
  const factor = likelihoodFactor('pression_basse', {
    kind: 'numeric',
    quantity_id: 'pression_circuit_bar',
    band: 'above',
  });
  assert.ok(factor < 1, 'pression_basse prédit low — above doit réfuter');
});
