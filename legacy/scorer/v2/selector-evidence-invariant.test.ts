/**
 * Invariant permanent : max_top_prior(D) > max_top_prior(R).
 * CDC §8 — le sélecteur VOI doit accumuler plus d'évidence que le hasard.
 *
 * Rouge tant que le VOI reste bloqué sur OBS-* (run pilote 2026-07-26 : D=0,542, R=0,717).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { measureSelectorEvidenceInvariant } from '../../lib/selector-evidence-invariant.js';
import { loadV2Cases, type PilotCaseExtended } from '../../runners/v2-harness.js';

function loadDiagnosableCases(): PilotCaseExtended[] {
  return loadV2Cases().filter(
    (c) => c.meta.family !== 'escalade_legitime' && c.meta.family !== 'hors_corpus',
  ) as PilotCaseExtended[];
}

test('max_top_prior(D) > max_top_prior(R) — sélecteur VOI vs hasard', () => {
  const m = measureSelectorEvidenceInvariant(loadDiagnosableCases());

  const offenders = m.per_case
    .filter((p) => p.max_top_prior_R >= p.max_top_prior_D)
    .map((p) => `${p.case_id}: D=${p.max_top_prior_D.toFixed(3)} R=${p.max_top_prior_R.toFixed(3)}`);

  assert.ok(
    m.invariant_holds,
    [
      `Invariant violé : max_top_prior(D)=${m.max_top_prior_D.toFixed(3)} ≤ max_top_prior(R)=${m.max_top_prior_R.toFixed(3)}`,
      offenders.length ? `Cas où R≥D: ${offenders.join('; ')}` : '',
      'Le VOI doit concentrer le posterior mieux que le hasard — enrichir matrice / débloquer MES-*/MAN-*.',
    ]
      .filter(Boolean)
      .join('\n'),
  );
});
