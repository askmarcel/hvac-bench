/**
 * Parité matrice : HYPOTHESIS_ACTIONS (canonical) === snapshot taxonomy (bench/prod sink).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

import {
  HYPOTHESIS_ACTIONS,
  matricesEqual,
  normalizeMatrixForSnapshot,
} from '../../lib/hypothesis-matrix.js';

const SNAPSHOT_PATH = resolve(
  import.meta.dirname,
  '../../taxonomy/hypothesis-matrix-v2.json',
);

test('HYPOTHESIS_ACTIONS === taxonomy/hypothesis-matrix-v2.json (D_local ≡ sink enrich)', () => {
  const snap = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as {
    hypothesis_actions: Record<string, string[]>;
  };
  const diffs = matricesEqual(
    normalizeMatrixForSnapshot(HYPOTHESIS_ACTIONS),
    snap.hypothesis_actions,
  );
  assert.equal(
    diffs.length,
    0,
    `Matrice désalignée pour: ${diffs.join(', ')} — relancer pnpm sync:hypothesis-matrix`,
  );
});
