import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resetKnowledgeCache } from '../../lib/v3/knowledge-loader.js';
import { readObservation } from '../../lib/v3/read-observation.js';

test('readObservation — ΔT 1,8 K plancher → below', () => {
  resetKnowledgeCache();
  const obs = readObservation(
    { quantity_id: 'delta_t_eau', value: 1.8, unit: 'K' },
    { equipment_type: 'pac_air_eau', emitter: 'plancher_chauffant' },
  );
  assert.equal(obs.kind, 'numeric');
  if (obs.kind === 'numeric') assert.equal(obs.band, 'below');
});

test('readObservation — pression 1,5 bar → in', () => {
  resetKnowledgeCache();
  const obs = readObservation(
    { quantity_id: 'pression_circuit_bar', value: 1.5, unit: 'bar' },
    { equipment_type: 'pac_air_eau' },
  );
  assert.equal(obs.kind, 'numeric');
  if (obs.kind === 'numeric') assert.equal(obs.band, 'in');
});

test('readObservation — pseudo-modalité low → below', () => {
  resetKnowledgeCache();
  const obs = readObservation(
    { quantity_id: 'delta_t_eau', modality: 'low' },
    { equipment_type: 'pac_air_eau', emitter: 'plancher_chauffant' },
  );
  assert.equal(obs.kind, 'numeric');
  if (obs.kind === 'numeric') assert.equal(obs.band, 'below');
});

test('readObservation — pseudo-modalité normal sur débit → in', () => {
  resetKnowledgeCache();
  const obs = readObservation(
    { quantity_id: 'debit_l_min', modality: 'normal' },
    { equipment_type: 'pac_air_eau' },
  );
  assert.equal(obs.kind, 'numeric');
  if (obs.kind === 'numeric') assert.equal(obs.band, 'in');
});

test('readObservation — échec synthétique valeur haute hors plage', () => {
  resetKnowledgeCache();
  const obs = readObservation(
    { quantity_id: 'delta_t_eau', value: 25, unit: 'K' },
    { equipment_type: 'pac_air_eau', emitter: 'plancher_chauffant' },
  );
  assert.equal(obs.kind, 'numeric');
  if (obs.kind === 'numeric') assert.notEqual(obs.band, 'below');
});
