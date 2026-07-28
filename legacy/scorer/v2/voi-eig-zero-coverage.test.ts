/**
 * Garde-fou recouvrement action×cause — post-suppression fallback P0 v3.
 * La majorité EIG=0 doit rester visible (pas masquée par gain H×0,35).
 * Le mode dégradé est `escalate` (cf. pick-next-escalate.test.ts).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  analyzePilotEig,
  eigZeroCoverageGuard,
  MAX_PCT_EXACT_ZERO_EIG,
} from '../../lib/voi-eig-analysis.js';
import { diagnosticActionIds, loadV2Cases, type PilotCaseExtended } from '../../runners/v2-harness.js';

function loadDiagnosableCases(): PilotCaseExtended[] {
  return loadV2Cases().filter(
    (c) => c.meta.family !== 'escalade_legitime' && c.meta.family !== 'hors_corpus',
  ) as PilotCaseExtended[];
}

test('recouvrement action×cause — majorité EIG=0 visible sans fallback (escalade requise)', () => {
  const report = analyzePilotEig(loadDiagnosableCases(), diagnosticActionIds());
  const guard = eigZeroCoverageGuard(report);
  assert.ok(
    guard.pct_exact_zero > MAX_PCT_EXACT_ZERO_EIG,
    `${(guard.pct_exact_zero * 100).toFixed(1)} % EIG=0 — attendu >50 % tant que matrice action×cause est creuse`,
  );
});
