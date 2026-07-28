/**
 * Mesure EIG réel par action (tour 0, priors pilote) avant toute modification matrice.
 *
 * Usage: pnpm measure:eig-pilot
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { analyzePilotEig, eigVarianceGuard, eigZeroCoverageGuard } from '../lib/voi-eig-analysis.js';
import { measureSelectorEvidenceInvariant } from '../lib/selector-evidence-invariant.js';
import { diagnosticActionIds, loadV2Cases, type PilotCaseExtended } from '../runners/v2-harness.js';

function loadDiagnosableCases(): PilotCaseExtended[] {
  return loadV2Cases().filter(
    (c) => c.meta.family !== 'escalade_legitime' && c.meta.family !== 'hors_corpus',
  ) as PilotCaseExtended[];
}

function main() {
  const cases = loadDiagnosableCases();
  const candidates = diagnosticActionIds();
  const report = analyzePilotEig(cases, candidates);
  const guard = eigVarianceGuard(report);
  const zeroGuard = eigZeroCoverageGuard(report);
  const selector = measureSelectorEvidenceInvariant(cases);
  const engineMismatch = report.cases.filter(
    (c) => c.engine_pick_action && c.eig_max_action !== c.engine_pick_action,
  ).length;

  const outDir = resolve(import.meta.dirname, '../reports');
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, 'eig-pilot-turn0-2026-07-27.json');
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        ...report,
        selector_invariant: selector,
        eig_variance_guard: guard,
        eig_zero_coverage_guard: zeroGuard,
        engine_pick_mismatch_cases: engineMismatch,
      },
      null,
      2,
    ) + '\n',
  );

  console.log(`Cas diagnostiques: ${cases.length}`);
  console.log(`EIG poolé — médiane=${report.pooled_eig.median.toFixed(4)} std=${report.pooled_eig.std.toFixed(4)} bit`);
  console.log(`EIG=0 exact — ${(report.pooled_eig.pct_exact_zero * 100).toFixed(1)} % des couples action×cas`);
  console.log(`EIG std médian par cas: ${report.per_case_median_eig_std.toFixed(4)}`);
  console.log(
    `Ratio médian EIG_max/(λ·Δcost) [EIG brute — ne prédit pas le moteur]: ${report.per_case_median_eig_max_over_lambda_delta?.toFixed(4) ?? 'n/a'}`,
  );
  console.log(`Cas où engine_pick ≠ eig_max: ${engineMismatch}/${cases.length}`);
  console.log(`Invariant D>R: ${selector.invariant_holds ? 'PASS' : 'FAIL'} (D=${selector.max_top_prior_D.toFixed(3)} R=${selector.max_top_prior_R.toFixed(3)})`);
  console.log(`Garde EIG variance: ${guard.ok ? 'PASS' : 'FAIL'} (std=${guard.pooled_std.toFixed(4)} méd=${guard.pooled_median.toFixed(4)})`);
  console.log(
    `Garde EIG=0: ${zeroGuard.ok ? 'PASS' : 'FAIL'} (${(zeroGuard.pct_exact_zero * 100).toFixed(1)} % > ${zeroGuard.threshold_max * 100} %)`,
  );
  console.log(`\nTop actions (EIG moyen):`);
  for (const t of report.top_eig_actions_pooled.slice(0, 8)) {
    console.log(`  ${t.action_id}: ${t.mean_eig.toFixed(4)} bit (${t.n_cases} cas)`);
  }
  console.log(`\n${report.diagnosis}`);
  console.log(`Rapport: ${outPath}`);
}

main();
