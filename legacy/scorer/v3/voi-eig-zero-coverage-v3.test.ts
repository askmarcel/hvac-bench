/**
 * Garde H1 — pct_exact_zero v3 < 30 %.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  analyzePilotEigV3,
  eigZeroCoverageGuardV3,
  H1_MAX_PCT_EXACT_ZERO_EIG,
} from '../../lib/voi-eig-analysis.js';
import { loadDiagnosableV3Cases } from '../../runners/v3-harness.js';

test('H1 v3 — pct_exact_zero < 30 % sur pilote diagnostique', () => {
  const report = analyzePilotEigV3(loadDiagnosableV3Cases());
  const guard = eigZeroCoverageGuardV3(report);
  assert.ok(
    guard.ok,
    `H1 FAIL: ${(guard.pct_exact_zero * 100).toFixed(1)} % EIG=0 (seuil ${H1_MAX_PCT_EXACT_ZERO_EIG * 100} %)`,
  );
  assert.ok(report.pooled_eig.median > 0, 'médiane EIG poolée doit être > 0');
});

test('H1 v3 — échec synthétique seuil 0 % (toujours pass)', () => {
  const fakeReport = {
    pooled_eig: { pct_exact_zero: 0, median: 0.1, std: 0.05, n_samples: 100 },
  } as Parameters<typeof eigZeroCoverageGuardV3>[0];
  assert.ok(eigZeroCoverageGuardV3(fakeReport).ok);
});
