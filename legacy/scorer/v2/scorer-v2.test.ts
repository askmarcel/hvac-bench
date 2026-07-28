import assert from 'node:assert/strict';
import { test } from 'node:test';

import { scoreV2Run, scoreV2RunLegacy } from './index.js';
import type { V2Case, V2RunRecord } from './types.js';

function baseCase(over: Partial<V2Case> = {}): V2Case {
  return {
    id: 'hb2-test',
    hypotheses: [
      { id: 'cause_a', true_cause: true },
      { id: 'cause_b', true_cause: false },
    ],
    tests: [{ action_id: 'MES-DEBIT', observation: 'ok', resolves: true }],
    expert_path: ['MES-DEBIT'],
    meta: { family: 'code_multi_cause' },
    flags: { sparse_priors: false },
    ...over,
  };
}

function record(over: Partial<V2RunRecord> = {}): V2RunRecord {
  return {
    case_id: 'hb2-test',
    replicate: 0,
    arm: 'D',
    path: ['MES-DEBIT'],
    concluded: true,
    cause_id: 'cause_a',
    true_cause_id: 'cause_a',
    turns: 1,
    final_output: { state: 'conclusion', cause_id: 'cause_a' },
    ...over,
  };
}

test('escalation_precision compte FP hors escalade_legitime (v0.2)', () => {
  const c = baseCase();
  const wrongEsc = record({
    concluded: false,
    cause_id: null,
    final_output: { state: 'escalation' },
  });
  const m = scoreV2Run([c], [wrongEsc]);
  assert.equal(m.escalation_precision, 0);
  const legacy = scoreV2RunLegacy([c], [wrongEsc]);
  assert.equal(legacy.escalation_precision, 1);
});

test('premature_closure denominateur = sessions conclues (v0.2)', () => {
  const c = baseCase();
  const wrong = record({ cause_id: 'cause_b' });
  const noConclude = record({
    concluded: false,
    cause_id: null,
    final_output: { state: 'non_convergent' },
    path: [],
  });
  const m = scoreV2Run([c], [wrong, noConclude]);
  assert.equal(m.premature_closure_rate, 1);
  const legacy = scoreV2RunLegacy([c], [wrong, noConclude]);
  assert.equal(legacy.premature_closure_rate, 0.5);
});

test('premature_closure null si aucune session conclue', () => {
  const c = baseCase();
  const noConclude = record({
    concluded: false,
    cause_id: null,
    final_output: { state: 'non_convergent' },
    path: ['OBS-GAZ'],
  });
  const m = scoreV2Run([c], [noConclude]);
  assert.equal(m.premature_closure_rate, null);
});

test('path_cost_ratio n/a si n_eligible < 10', () => {
  const c = baseCase();
  const ok = record();
  const m = scoreV2Run([c], [ok]);
  assert.equal(m.path_cost_ratio_median, null);
  assert.equal(m.path_cost_ratio_n, 1);
});

test('O_plomberie converge sur expert_path', () => {
  const c = baseCase();
  const m = scoreV2Run([c], [record()]);
  assert.equal(m.convergence_at_5, 1);
});
