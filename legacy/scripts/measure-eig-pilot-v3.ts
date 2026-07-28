/**
 * Mesure EIG v3 — tour 0, pilote v3 (H1).
 * Usage: pnpm measure:eig-pilot-v3
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  analyzePilotEigV3,
  eigZeroCoverageGuardV3,
  H1_MAX_PCT_EXACT_ZERO_EIG,
} from '../lib/voi-eig-analysis.js';
import {
  GATE_DIAGNOSTIC_CASE_IDS,
  GATE_ESCALADE_EXCLUSIONS,
  GATE_PILOT_PAC_COUNT,
} from '../lib/v3/gate-roster.js';
import { loadDiagnosableV3Cases } from '../runners/v3-harness.js';

function main() {
  const cases = loadDiagnosableV3Cases();
  const report = analyzePilotEigV3(cases);
  const guard = eigZeroCoverageGuardV3(report);

  const outDir = resolve(import.meta.dirname, '../reports');
  mkdirSync(outDir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const outPath = resolve(outDir, `eig-pilot-v3-${date}.json`);
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        ...report,
        h1_guard: guard,
        hypothesis: 'H1',
        roster: {
          pilot_pac_total: GATE_PILOT_PAC_COUNT,
          gate_diagnostic_count: GATE_DIAGNOSTIC_CASE_IDS.length,
          gate_diagnostic_case_ids: [...GATE_DIAGNOSTIC_CASE_IDS],
          excluded_escalade: { ...GATE_ESCALADE_EXCLUSIONS },
          exclusion_reason_field: 'meta.family === escalade_legitime',
        },
      },
      null,
      2,
    ) + '\n',
  );

  console.log(`Cas diagnostiques gate: ${cases.length} / ${GATE_PILOT_PAC_COUNT} pilote PAC`);
  console.log(
    `EIG poolé — médiane=${report.pooled_eig.median.toFixed(4)} std=${report.pooled_eig.std.toFixed(4)} bit`,
  );
  console.log(
    `EIG=0 exact — ${(report.pooled_eig.pct_exact_zero * 100).toFixed(1)} % (seuil H1 < ${H1_MAX_PCT_EXACT_ZERO_EIG * 100} %)`,
  );
  console.log(`Garde H1: ${guard.ok ? 'PASS' : 'FAIL'}`);
  console.log(`\n${report.diagnosis}`);
  console.log(`Rapport: ${outPath}`);
}

main();
