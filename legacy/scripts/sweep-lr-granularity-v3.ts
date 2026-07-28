/**
 * Sweep H4 — granularité LR (3 crans vs profil ajusté pré-pinné).
 * Usage: pnpm run:v3:sweep-lr-h4
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isExecutedDirectly } from '../lib/cli-entry.js';

import { LR_VALUES } from '../lib/v3/constants.js';
import { resetKnowledgeCache, setLrValuesOverride } from '../lib/v3/knowledge-loader.js';
import { PATHS } from '../lib/v3/paths.js';
import type { LrTier } from '../lib/v3/constants.js';
import { runOtreeDbBatch } from '../runners/arm-o-tree-db.js';

type LrProfile = {
  name: string;
  lr_tiers: Record<LrTier, number>;
};

function loadAdjustedProfile(): LrProfile {
  const file = JSON.parse(readFileSync(PATHS.likelihoodsV3Adjusted, 'utf8')) as {
    lr_tiers: Record<LrTier, number>;
  };
  return { name: 'adjusted', lr_tiers: file.lr_tiers };
}

export function runLrGranularitySweep() {
  const profiles: LrProfile[] = [
    { name: 'tier3_default', lr_tiers: { ...LR_VALUES } },
    loadAdjustedProfile(),
  ];

  const results: Array<{
    profile: string;
    lr_tiers: Record<LrTier, number>;
    conv_at_5: number;
    numerator: number;
    denominator: number;
    run_dir: string;
  }> = [];

  for (const profile of profiles) {
    resetKnowledgeCache();
    setLrValuesOverride(profile.lr_tiers);
    const batch = runOtreeDbBatch({
      includeEscalade: false,
      runKind: 'falsification_p2_h4_lr_sweep',
      lrProfile: profile.name,
    });
    results.push({
      profile: profile.name,
      lr_tiers: profile.lr_tiers,
      conv_at_5: batch.diagnosticScores.convergence_at_5,
      numerator: batch.diagnosticScores.convergence_at_5_numerator,
      denominator: batch.diagnosticScores.convergence_at_5_denominator,
      run_dir: batch.outDir,
    });
    resetKnowledgeCache();
  }

  const deltaCases = Math.abs(results[0]!.numerator - results[1]!.numerator);
  const h4Pass = deltaCases <= 1;

  const date = new Date().toISOString().slice(0, 10);
  const report = {
    generated_at: new Date().toISOString(),
    hypothesis: 'H4',
    profiles: results,
    delta_cases: deltaCases,
    threshold_max_delta_cases: 1,
    verdict: h4Pass ? 'PASS' : 'FAIL',
  };

  const outDir = resolve(import.meta.dirname, '../reports');
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, `lr-granularity-sweep-${date}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');

  console.log('H4 sweep:', report);
  console.log(`Rapport: ${outPath}`);

  return { report, outPath };
}

function main() {
  runLrGranularitySweep();
}

if (isExecutedDirectly(import.meta.url)) {
  main();
}
