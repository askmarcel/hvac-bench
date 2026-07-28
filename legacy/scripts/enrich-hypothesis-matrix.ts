/**
 * Pousse HYPOTHESIS_ACTIONS (canonical) → Supabase diag_hypotheses + snapshot taxonomy.
 * Source unique : canonical-hypotheses.ts — D_local et D API doivent rester alignés.
 *
 * Indicateur d'enrichissement : pouvoir discriminant par action (cible 1–3 causes), pas % couverture.
 *
 * Usage:
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... pnpm enrich:hypothesis-matrix
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createClient } from '@supabase/supabase-js';

import {
  CANONICAL_LABELS,
  HYPOTHESIS_ACTIONS,
} from '../../AskMarcel-WebApp-NextJS/lib/diagnostic-v2/canonical-hypotheses';

import { specificitySummary } from '../lib/hypothesis-matrix.js';
import { MATRIX_SNAPSHOT_VERSION, writeMatrixSnapshot } from './sync-hypothesis-matrix.js';

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
  }

  const specBefore = specificitySummary(HYPOTHESIS_ACTIONS);
  const reportsDir = resolve(import.meta.dirname, '../reports');
  const specReportPath = resolve(reportsDir, 'matrix-specificity-latest.json');
  let priorAfter = null;
  try {
    priorAfter = JSON.parse(readFileSync(specReportPath, 'utf8')).after;
  } catch {
    /* premier run */
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const rows = Object.entries(HYPOTHESIS_ACTIONS).map(([hypothesis_id, discriminating_actions]) => ({
    hypothesis_id,
    label: CANONICAL_LABELS[hypothesis_id as keyof typeof CANONICAL_LABELS] ?? hypothesis_id,
    equipment_type: 'autre',
    organ: null,
    discriminating_actions,
  }));

  for (let i = 0; i < rows.length; i += 50) {
    const chunk = rows.slice(i, i + 50);
    const { error } = await supabase
      .from('diag_hypotheses')
      .upsert(chunk, { onConflict: 'hypothesis_id' });
    if (error) throw error;
  }

  const { spec: specAfter } = writeMatrixSnapshot(MATRIX_SNAPSHOT_VERSION);

  const report = {
    enriched_at: new Date().toISOString(),
    matrix_version: MATRIX_SNAPSHOT_VERSION,
    hypotheses: rows.length,
    source: 'canonical-hypotheses.ts',
    sinks: ['diag_hypotheses (Supabase)', 'taxonomy/hypothesis-matrix-v2.json'],
    specificity: {
      note: 'Mesurer EIG et masse a priori (pnpm measure:eig-pilot) — pas objectif compte 1-3 causes',
      before: priorAfter ?? {
        median_hypotheses_per_action: specBefore.median_hypotheses_per_action,
        in_band_1_to_3: specBefore.in_band_1_to_3,
        over_broad_gt_3: specBefore.over_broad_gt_3,
      },
      after: {
        median_hypotheses_per_action: specAfter.median_hypotheses_per_action,
        in_band_1_to_3: specAfter.in_band_1_to_3,
        over_broad_gt_3: specAfter.over_broad_gt_3,
        over_broad_actions: specAfter.over_broad_actions,
      },
    },
    avg_actions_per_hypothesis:
      Math.round((rows.reduce((s, r) => s + r.discriminating_actions.length, 0) / rows.length) * 10) /
      10,
  };

  writeFileSync(resolve(reportsDir, 'matrix-enrich-latest.json'), JSON.stringify(report, null, 2) + '\n');
  writeFileSync(specReportPath, JSON.stringify(report, null, 2) + '\n');

  console.log(JSON.stringify(report, null, 2));
  console.log('\nVérifier parité prod: pnpm check:hypothesis-matrix-parity');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
