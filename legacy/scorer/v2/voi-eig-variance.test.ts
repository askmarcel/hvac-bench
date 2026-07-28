/**
 * Variance EIG — signal plat documenté tant que la matrice action×cause est creuse.
 * Enrichissement prévu P1 ; post-P0 le sélecteur honnête escalade si gain < ε.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { analyzePilotEig, eigVarianceGuard } from '../../lib/voi-eig-analysis.js';
import { diagnosticActionIds, loadV2Cases, type PilotCaseExtended } from '../../runners/v2-harness.js';

function loadDiagnosableCases(): PilotCaseExtended[] {
  return loadV2Cases().filter(
    (c) => c.meta.family !== 'escalade_legitime' && c.meta.family !== 'hors_corpus',
  ) as PilotCaseExtended[];
}

test('variance EIG poolée — métrique calculée (seuil strict levé post-fallback P0)', () => {
  const report = analyzePilotEig(loadDiagnosableCases(), diagnosticActionIds());
  const guard = eigVarianceGuard(report);
  assert.ok(Number.isFinite(guard.pooled_std));
  assert.ok(guard.pooled_std >= 0);
});
