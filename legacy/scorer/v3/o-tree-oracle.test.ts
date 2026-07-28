import assert from 'node:assert/strict';
import test from 'node:test';

import { runCaseOtreeDb } from '../../runners/o-tree-case.js';
import { replayCaseV3 } from '../../lib/v3/engine-v3.js';
import type { V3Case } from '../../lib/v3/types.js';

function syntheticEscaladeCase(): V3Case {
  return {
    id: 'synth-escalade-001',
    version: 3,
    split: 'synthetic',
    locale: 'fr',
    symptom: { narrative: 'test', code_present: null },
    context: { equipment_type: 'pac_air_eau', in_corpus: false },
    observations: [
      {
        action_id: 'MES-PRESSION',
        reading: { quantity_id: 'pression_circuit_bar', value: 1.5, unit: 'bar' },
      },
      {
        action_id: 'REM-CIRCULATEUR',
        reading: { quantity_id: 'debit_l_min', modality: 'normal' },
        resolves: true,
      },
      {
        action_id: 'ESC-SAV',
        reading: { quantity_id: 'led_defaut', modality: 'code' },
      },
    ],
    ground_truth: { cause_id: 'pompe_grippee' },
    expert_path: ['MES-PRESSION', 'ESC-SAV'],
    meta: { family: 'escalade_legitime' },
  };
}

test('O_tree_db suit expert_path et ignore observations hors chemin', () => {
  const c = syntheticEscaladeCase();
  const oracle = runCaseOtreeDb(c, 0);
  const replay = replayCaseV3(c);

  assert.equal(oracle.path.join(','), 'MES-PRESSION,ESC-SAV');
  assert.notEqual(replay.path.join(','), oracle.path.join(','), 'replayCaseV3 ne doit pas être utilisé comme oracle');
  assert.equal(oracle.final_output.state, 'escalation');
  assert.equal(oracle.concluded, false);
  assert.equal(oracle.cause_id, null);
});

test('O_tree_db n atteint pas REM-CIRCULATEUR décoy sur chemin expert court', () => {
  const c = syntheticEscaladeCase();
  const oracle = runCaseOtreeDb(c, 0);
  assert.ok(!oracle.path.includes('REM-CIRCULATEUR'));
});
