import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  actionPrefixPriority,
  compareActionsTieBreak,
  pickNextAction,
  type HypothesisState,
} from '../../lib/bayes-engine.js';

test('compareActionsTieBreak préfère OBS à REM', () => {
  assert.ok(compareActionsTieBreak('OBS-PRESSION', 'REM-SONDE') < 0);
  assert.ok(compareActionsTieBreak('MES-DEBIT', 'MAN-PURGE') < 0);
});

test('pickNextAction tie-break déterministe sans sessionSeed', () => {
  const hypotheses: HypothesisState[] = [
    { id: 'filtre_colmate', label: 'Filtre', prior: 0.5 },
    { id: 'air_circuit', label: 'Air', prior: 0.5 },
  ];
  const costs = new Map([
    ['OBS-PRESSION', 25],
    ['REM-SONDE', 25],
    ['MES-DEBIT', 25],
  ]);
  const hypothesisActions = new Map([
    ['filtre_colmate', ['OBS-PRESSION', 'REM-SONDE', 'MES-DEBIT']],
    ['air_circuit', ['OBS-PURGEUR']],
  ]);

  const pick1 = pickNextAction(
    hypotheses,
    ['OBS-PRESSION', 'REM-SONDE', 'MES-DEBIT'],
    costs,
    new Set(),
    hypothesisActions,
  );
  const pick2 = pickNextAction(
    hypotheses,
    ['OBS-PRESSION', 'REM-SONDE', 'MES-DEBIT'],
    costs,
    new Set(),
    hypothesisActions,
  );

  assert.equal(pick1, pick2);
  assert.equal(pick1, 'OBS-PRESSION');
  assert.ok(actionPrefixPriority('OBS-PRESSION') < actionPrefixPriority('REM-SONDE'));
});
