/**
 * Écrit taxonomy/hypothesis-matrix-v2.json depuis HYPOTHESIS_ACTIONS (canonical).
 * Appelé par enrich:hypothesis-matrix après upsert Supabase.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  HYPOTHESIS_ACTIONS,
  normalizeMatrixForSnapshot,
  specificitySummary,
} from '../lib/hypothesis-matrix.js';

export const MATRIX_SNAPSHOT_VERSION = 'pilot-enriched-2026-07-26';

export function snapshotPath(): string {
  return resolve(import.meta.dirname, '../taxonomy/hypothesis-matrix-v2.json');
}

export function writeMatrixSnapshot(matrixVersion = MATRIX_SNAPSHOT_VERSION) {
  const hypothesis_actions = normalizeMatrixForSnapshot(HYPOTHESIS_ACTIONS);
  const spec = specificitySummary(hypothesis_actions);
  const payload = {
    version: matrixVersion,
    synced_at: new Date().toISOString(),
    source: 'AskMarcel-WebApp-NextJS/lib/diagnostic-v2/canonical-hypotheses.ts',
    hypothesis_actions,
    specificity: {
      median_hypotheses_per_action: spec.median_hypotheses_per_action,
      in_band_1_to_3: spec.in_band_1_to_3,
      over_broad_gt_3: spec.over_broad_gt_3,
    },
  };
  mkdirSync(resolve(import.meta.dirname, '../taxonomy'), { recursive: true });
  writeFileSync(snapshotPath(), JSON.stringify(payload, null, 2) + '\n');
  return { payload, spec };
}

export function loadMatrixSnapshot(): Record<string, string[]> {
  const snap = JSON.parse(readFileSync(snapshotPath(), 'utf8')) as {
    hypothesis_actions: Record<string, string[]>;
  };
  return snap.hypothesis_actions;
}

function main() {
  const prevPath = resolve(import.meta.dirname, '../reports/matrix-specificity-latest.json');
  let before = null;
  try {
    before = JSON.parse(readFileSync(prevPath, 'utf8'));
  } catch {
    /* premier run */
  }

  const { spec } = writeMatrixSnapshot();
  const report = {
    measured_at: new Date().toISOString(),
    before: before?.after ?? null,
    after: {
      ...spec,
      over_broad_actions: spec.over_broad_actions.map((p) => ({
        action_id: p.action_id,
        n_hypotheses: p.n_hypotheses,
      })),
    },
    note: 'Compte de causes = diagnostic structurel. Mesurer EIG/masse a priori via pnpm measure:eig-pilot avant enrichissement.',
  };
  mkdirSync(resolve(import.meta.dirname, '../reports'), { recursive: true });
  writeFileSync(prevPath, JSON.stringify(report, null, 2) + '\n');

  console.log(`Snapshot: ${snapshotPath()}`);
  console.log(
    `Structure: médiane causes/action=${spec.median_hypotheses_per_action} | actions >3 causes=${spec.over_broad_gt_3}`,
  );
  console.log('Mesurer EIG avant modification: pnpm measure:eig-pilot');
}

main();
