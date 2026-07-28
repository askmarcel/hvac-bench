import assert from 'node:assert/strict';
import { test } from 'node:test';

import { expertPathFirstHit, invasiveWrongFirst, wrongPartHit } from './oracle-metrics.js';
import type { V2Case, V2RunRecord } from './types.js';

const baseCase: V2Case = {
  id: 'hb2-0012',
  hypotheses: [{ id: 'filtre_colmate', true_cause: true }],
  tests: [{ action_id: 'REM-SONDE', observation: 'ok', wrong_part: true }],
  expert_path: ['DEM-FILTRE', 'MAN-NETTOYAGE-FILTRE'],
  meta: { family: 'code_trompeur' },
  flags: { sparse_priors: false },
};

test('expert_path_first_hit détecte alignement', () => {
  const hit = expertPathFirstHit(baseCase, {
    case_id: 'hb2-0012',
    replicate: 0,
    arm: 'D',
    path: ['DEM-FILTRE'],
    concluded: false,
    cause_id: null,
    true_cause_id: 'filtre_colmate',
    turns: 1,
    final_output: {},
  });
  assert.equal(hit, true);
});

test('invasive_wrong_first sur REM hors expert_path', () => {
  const rec: V2RunRecord = {
    case_id: 'hb2-0012',
    replicate: 0,
    arm: 'D',
    path: ['REM-SONDE'],
    concluded: false,
    cause_id: null,
    true_cause_id: 'filtre_colmate',
    turns: 1,
    final_output: {},
  };
  assert.equal(invasiveWrongFirst(baseCase, rec), true);
  assert.equal(wrongPartHit(baseCase, rec), true);
});
