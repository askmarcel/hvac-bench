import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  isConcludableHypothesis,
  shouldConclude,
  type HypothesisState,
} from '../../lib/bayes-engine.js';
import { runCaseObayes } from '../../runners/o-bayes-case.js';
import { loadV2Cases } from '../../runners/v2-harness.js';

test('shouldConclude ne conclut jamais sur cause_inconnue', () => {
  const hyps: HypothesisState[] = [
    { id: 'cause_inconnue', label: 'Inconnue', prior: 0.95 },
    { id: 'air_circuit', label: 'Air', prior: 0.05 },
  ];
  const { conclude, causeId } = shouldConclude(hyps, true);
  assert.equal(conclude, false);
  assert.equal(causeId, null);
  assert.ok(isConcludableHypothesis('air_circuit'));
  assert.ok(!isConcludableHypothesis('cause_inconnue'));
});

test('hb2-0010 REM-SONDE : supports après réparation (pas refutes sur stable)', () => {
  const c = loadV2Cases().find((x) => x.id === 'hb2-0010');
  assert.ok(c);
  const rem = c.tests.find((t) => t.action_id === 'REM-SONDE');
  assert.equal(rem?.polarity, 'supports');
  const rec = runCaseObayes(c, 0);
  assert.equal(rec.concluded, true);
  assert.equal(rec.cause_id, 'sonde_hs');
});
