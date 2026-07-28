/**
 * Snapshot posteriors finaux O_bayes — tout changement de vraisemblance/polarité produit un diff lisible.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

import { runCaseObayes } from '../../runners/o-bayes-case.js';
import { loadV2Cases, trueCauseId } from '../../runners/v2-harness.js';
import { scoreV2Run } from './index.js';

const SNAPSHOT_PATH = resolve(
  import.meta.dirname,
  '../../fixtures/o-bayes-posterior-snapshot-v1.json',
);

const O_BAYES_MIN_CONV_AT_5 = 11 / 15;

type SnapshotCase = {
  concluded: boolean;
  cause_id: string | null;
  true_cause_id: string;
  true_cause_prior: number;
  posteriors: Record<string, number>;
};

type Snapshot = {
  version: string;
  cases: Record<string, SnapshotCase>;
  convergence_at_5?: number;
};

function loadDiagnosableCases() {
  return loadV2Cases().filter(
    (c) => c.meta.family !== 'escalade_legitime' && c.meta.family !== 'hors_corpus',
  );
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

test('O_bayes conv@5 < 1 (anti-tautologie resolves)', () => {
  const cases = loadDiagnosableCases();
  const m = scoreV2Run(cases, cases.map((c) => runCaseObayes(c, 0)));
  assert.ok(m.convergence_at_5 < 1, `conv@5=${m.convergence_at_5}`);
});

test('O_bayes conv@5 >= 11/15 (plancher non-régression)', () => {
  const cases = loadDiagnosableCases();
  const m = scoreV2Run(cases, cases.map((c) => runCaseObayes(c, 0)));
  assert.ok(
    m.convergence_at_5 >= O_BAYES_MIN_CONV_AT_5,
    `conv@5=${m.convergence_at_5} < 11/15`,
  );
});

test('O_bayes posteriors finaux == snapshot versionné', () => {
  const snap = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as Snapshot;
  assert.equal(snap.version, 'o-bayes-posterior-v1');

  const cases = loadDiagnosableCases();
  const diffs: string[] = [];

  for (const c of cases) {
    const expected = snap.cases[c.id];
    assert.ok(expected, `snapshot manquant pour ${c.id}`);

    const r = runCaseObayes(c, 0);
    const sorted = [...(r.hypotheses_final ?? [])].sort((a, b) => b.prior - a.prior);
    const trueId = trueCauseId(c);
    const actualPrior = round6(sorted.find((h) => h.id === trueId)?.prior ?? 0);

    if (r.concluded !== expected.concluded || r.cause_id !== expected.cause_id) {
      diffs.push(
        `${c.id}: conclusion ${r.concluded}/${r.cause_id} != ${expected.concluded}/${expected.cause_id}`,
      );
    }
    if (actualPrior !== expected.true_cause_prior) {
      diffs.push(
        `${c.id}: true_cause_prior ${actualPrior} != ${expected.true_cause_prior}`,
      );
    }
    for (const [hid, p] of Object.entries(expected.posteriors)) {
      const actual = round6(sorted.find((h) => h.id === hid)?.prior ?? 0);
      if (actual !== p) {
        diffs.push(`${c.id}.${hid}: ${actual} != ${p}`);
      }
    }
  }

  assert.equal(diffs.length, 0, `Posterior drift:\n${diffs.join('\n')}`);
});
