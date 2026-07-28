import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  PICK_ESCALATE,
  pickNextAction,
  type HypothesisState,
} from '../../lib/bayes-engine.js';

test('pickNextAction — EIG nulle sur toutes les actions → escalate', () => {
  const hypotheses: HypothesisState[] = [
    { id: 'cause_inconnue', label: 'Inconnue', prior: 1 },
  ];
  const costs = new Map([
    ['OBS-PRESSION', 25],
    ['MES-DEBIT', 25],
    ['REM-SONDE', 25],
  ]);
  const hypothesisActions = new Map<string, string[]>();

  const pick = pickNextAction(
    hypotheses,
    ['OBS-PRESSION', 'MES-DEBIT', 'REM-SONDE'],
    costs,
    new Set(),
    hypothesisActions,
  );

  assert.equal(pick, PICK_ESCALATE);
});
