import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assertS2, evaluateRows } from './check-s2-priors.js';
import { finalizeSignaturePriors } from '../../AskMarcel-WebApp-NextJS/lib/diagnostic-v2/canonical-hypotheses';

test('gate information : filler-only fait rougir pct et entropie', () => {
  const rows = finalizeSignaturePriors(new Map([['cause_inconnue', 5]]), {
    signature: 'x',
    windowStart: '2026-01-01',
    windowEnd: '2026-07-26',
  });
  const h = evaluateRows(rows);
  assert.ok(h.pct_signatures_sans_cause_reelle >= 99);
  assert.ok(assertS2(h, 'test').length > 0);
});

test('gate information : distribution riche passe', () => {
  const rows = finalizeSignaturePriors(
    new Map([
      ['pression_basse', 24],
      ['air_circuit', 34],
      ['pompe_grippee', 20],
      ['flowswitch_hs', 12],
      ['filtre_colmate', 8],
    ]),
    {
      signature: 'y',
      windowStart: '2026-01-01',
      windowEnd: '2026-07-26',
    },
  );
  const h = evaluateRows(rows);
  assert.equal(h.pct_signatures_sans_cause_reelle, 0);
  assert.ok(h.entropie_mediane >= 2);
  assert.equal(assertS2(h, 'test').length, 0);
});
