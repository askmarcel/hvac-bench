/**
 * Vérifie max_top_prior(D) > max_top_prior(R) — invariant sélecteur §8.
 *
 * Usage: pnpm check:selector-invariant
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { measureSelectorEvidenceInvariant } from '../lib/selector-evidence-invariant.js';
import { loadV2Cases, type PilotCaseExtended } from '../runners/v2-harness.js';

function loadDiagnosableCases(): PilotCaseExtended[] {
  return loadV2Cases().filter(
    (c) => c.meta.family !== 'escalade_legitime' && c.meta.family !== 'hors_corpus',
  ) as PilotCaseExtended[];
}

function main() {
  const m = measureSelectorEvidenceInvariant(loadDiagnosableCases());
  const report = {
    generated_at: new Date().toISOString(),
    invariant: 'max_top_prior(D) > max_top_prior(R)',
    ...m,
  };

  const outDir = resolve(import.meta.dirname, '../reports');
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, 'selector-evidence-invariant-latest.json');
  writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');

  console.log(`max_top_prior(D) = ${m.max_top_prior_D.toFixed(3)}`);
  console.log(`max_top_prior(R) = ${m.max_top_prior_R.toFixed(3)}`);
  console.log(`Invariant: ${m.invariant_holds ? 'PASS' : 'FAIL'}`);
  console.log(`Rapport: ${outPath}`);

  if (!m.invariant_holds) {
    const worst = [...m.per_case].sort((a, b) => b.delta_D_minus_R - a.delta_D_minus_R).slice(0, 5);
    console.log('\nPires écarts (R>D):');
    for (const p of worst.filter((x) => x.delta_D_minus_R < 0)) {
      console.log(`  ${p.case_id}: D=${p.max_top_prior_D.toFixed(3)} R=${p.max_top_prior_R.toFixed(3)}`);
    }
    process.exit(1);
  }
}

main();
