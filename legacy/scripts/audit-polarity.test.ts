import assert from 'node:assert/strict';
import { test } from 'node:test';

import { auditPolarityFlags, inferPolarity } from './audit-polarity.js';

test('hb2-0009-like: supports incorrect sur appoint persistant est flaggé', () => {
  const flagged = auditPolarityFlags([
    {
      id: 'synthetic-hb2-0009',
      tests: [
        {
          action_id: 'MAN-REMPLISSAGE',
          observation: '1,5 bar après appoint',
          discriminates: ['pression_basse'],
          eliminates: [],
          polarity: 'supports',
        },
      ],
    },
  ]);
  assert.ok(flagged.length >= 1);
  assert.equal(inferPolarity('1,5 bar après appoint'), 'neutral');
});

test('accord explicite refutes non flaggé', () => {
  const flagged = auditPolarityFlags([
    {
      id: 'ok',
      tests: [
        {
          action_id: 'MAN-PURGE',
          observation: 'pression stable',
          discriminates: ['pression_basse'],
          eliminates: [],
          polarity: 'refutes',
        },
      ],
    },
  ]);
  assert.equal(flagged.length, 0);
});
