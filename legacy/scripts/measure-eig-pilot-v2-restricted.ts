/**
 * Mesure EIG v2 restreinte — même dénominateur que v3 (contrôle H1).
 *
 * 10 cas gate × ~19 actions MES/OBS (pas MAN/REM/blacklistées).
 * Compare à la baseline v2 pleine (15 cas × ~60 actions).
 *
 * Usage: pnpm measure:eig-pilot-v2-restricted
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  GATE_DIAGNOSTIC_CASE_IDS,
  GATE_ESCALADE_EXCLUSIONS,
  GATE_PILOT_PAC_COUNT,
  loadGateDiagnosticV2Cases,
} from '../lib/v3/gate-roster.js';
import { diagnosticActionIdsV3 } from '../lib/v3/hypothesis-actions.js';
import {
  analyzePilotEig,
  analyzePilotEigV3,
  H1_MAX_PCT_EXACT_ZERO_EIG,
  MAX_PCT_EXACT_ZERO_EIG,
} from '../lib/voi-eig-analysis.js';
import { loadDiagnosableV3Cases } from '../runners/v3-harness.js';

const V2_RESTRICTED_ZERO_THRESHOLD = 0.5;

function loadBaselineV2FullReport(): { pct_exact_zero: number; median: number; n_samples: number } | null {
  const path = resolve(import.meta.dirname, '../reports/eig-pilot-turn0-2026-07-27.json');
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as {
      pooled_eig: { pct_exact_zero: number; median: number; n_samples: number };
    };
    return raw.pooled_eig;
  } catch {
    return null;
  }
}

function main() {
  const mesObsActions = diagnosticActionIdsV3();
  const v2Cases = loadGateDiagnosticV2Cases();
  const v3Cases = loadDiagnosableV3Cases();

  const v2Restricted = analyzePilotEig(v2Cases, mesObsActions);
  const v3Report = analyzePilotEigV3(v3Cases);

  const baselineFull = loadBaselineV2FullReport();
  const h1Solid =
    v2Restricted.pooled_eig.pct_exact_zero >= V2_RESTRICTED_ZERO_THRESHOLD;

  const verdict = h1Solid
    ? 'H1_SOLIDE — v2-restreint reste ≥ 50 % EIG=0 ; la chute v2→v3 est majoritairement modèle'
    : 'H1_A_REQUALIFIER — v2-restreint < 50 % EIG=0 ; effet de périmètre action insuffisant pour expliquer la chute';

  const out = {
    generated_at: new Date().toISOString(),
    purpose: 'Contrôle H1 — dénominateur aligné v2 vs v3',
    roster: {
      pilot_pac_total: GATE_PILOT_PAC_COUNT,
      gate_diagnostic_count: GATE_DIAGNOSTIC_CASE_IDS.length,
      gate_diagnostic_case_ids: [...GATE_DIAGNOSTIC_CASE_IDS],
      excluded_escalade: { ...GATE_ESCALADE_EXCLUSIONS },
      candidate_actions: mesObsActions,
      n_candidate_actions: mesObsActions.length,
      expected_couples: GATE_DIAGNOSTIC_CASE_IDS.length * mesObsActions.length,
    },
    v2_full_baseline: baselineFull
      ? {
          source: 'reports/eig-pilot-turn0-2026-07-27.json',
          n_cases_note: '~15 diagnostiques v2',
          n_actions_note: '~60 (MAN/REM inclus)',
          pct_exact_zero: baselineFull.pct_exact_zero,
          median_eig: baselineFull.median,
          n_samples: baselineFull.n_samples,
        }
      : null,
    v2_restricted: {
      engine: 'v2',
      n_cases: v2Restricted.n_cases,
      n_actions: mesObsActions.length,
      pooled_eig: v2Restricted.pooled_eig,
      pct_exact_zero_threshold_solid_h1: V2_RESTRICTED_ZERO_THRESHOLD,
    },
    v3_same_roster: {
      engine: 'v3',
      n_cases: v3Report.n_cases,
      pooled_eig: v3Report.pooled_eig,
      h1_threshold_max_zero: H1_MAX_PCT_EXACT_ZERO_EIG,
      h1_guard_pass: v3Report.pooled_eig.pct_exact_zero <= H1_MAX_PCT_EXACT_ZERO_EIG,
    },
    comparison: {
      delta_pct_zero_v2_full_to_v2_restricted: baselineFull
        ? baselineFull.pct_exact_zero - v2Restricted.pooled_eig.pct_exact_zero
        : null,
      delta_pct_zero_v2_restricted_to_v3:
        v2Restricted.pooled_eig.pct_exact_zero - v3Report.pooled_eig.pct_exact_zero,
      delta_median_eig_v2_restricted_to_v3:
        v3Report.pooled_eig.median - v2Restricted.pooled_eig.median,
    },
    h1_verdict: verdict,
    h1_solid: h1Solid,
  };

  const outDir = resolve(import.meta.dirname, '../reports');
  mkdirSync(outDir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const jsonPath = resolve(outDir, `eig-pilot-v2-restricted-${date}.json`);
  const mdPath = resolve(outDir, `eig-pilot-v2-restricted-${date}.md`);

  writeFileSync(jsonPath, JSON.stringify(out, null, 2) + '\n');

  const md = `# Contrôle H1 — v2 restreint vs v3

**Date** : ${date}

## Dénominateur (pinné)

| Paramètre | Valeur |
|-----------|--------|
| Cas diagnostiques | ${GATE_DIAGNOSTIC_CASE_IDS.length} (${GATE_DIAGNOSTIC_CASE_IDS.join(', ')}) |
| Actions | ${mesObsActions.length} MES/OBS |
| Couples action×cas | ${GATE_DIAGNOSTIC_CASE_IDS.length * mesObsActions.length} |
| Exclus pilote (${GATE_PILOT_PAC_COUNT}) | hb2-0016, hb2-0017, hb2-0019 (\`escalade_legitime\`) |

## Résultats

| Mesure | % EIG=0 | Médiane EIG |
|--------|---------|-------------|
| v2 plein (baseline) | ${baselineFull ? `${(baselineFull.pct_exact_zero * 100).toFixed(1)} %` : 'n/a'} | ${baselineFull ? baselineFull.median.toFixed(4) : 'n/a'} bit |
| **v2 restreint** | **${(v2Restricted.pooled_eig.pct_exact_zero * 100).toFixed(1)} %** | ${v2Restricted.pooled_eig.median.toFixed(4)} bit |
| **v3** (même roster) | **${(v3Report.pooled_eig.pct_exact_zero * 100).toFixed(1)} %** | ${v3Report.pooled_eig.median.toFixed(4)} bit |

## Verdict H1

**${verdict}**

Seuil : v2-restreint ≥ ${V2_RESTRICTED_ZERO_THRESHOLD * 100} % EIG=0 → H1 solide ; v3 < ${H1_MAX_PCT_EXACT_ZERO_EIG * 100} % requis.
`;

  writeFileSync(mdPath, md);

  console.log(`Cas: ${v2Cases.length} | Actions MES/OBS: ${mesObsActions.length}`);
  console.log(
    `v2 restreint — médiane=${v2Restricted.pooled_eig.median.toFixed(4)} pct_zero=${(v2Restricted.pooled_eig.pct_exact_zero * 100).toFixed(1)}%`,
  );
  console.log(
    `v3          — médiane=${v3Report.pooled_eig.median.toFixed(4)} pct_zero=${(v3Report.pooled_eig.pct_exact_zero * 100).toFixed(1)}%`,
  );
  if (baselineFull) {
    console.log(
      `v2 plein    — pct_zero=${(baselineFull.pct_exact_zero * 100).toFixed(1)}% (${baselineFull.n_samples} couples)`,
    );
  }
  console.log(`\n${verdict}`);
  console.log(`JSON: ${jsonPath}`);
  console.log(`MD:   ${mdPath}`);
}

main();
