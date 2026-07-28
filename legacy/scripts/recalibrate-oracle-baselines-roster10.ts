/**
 * Recalcul baselines O_bayes / O_bayes_db sur roster gate 10 cas.
 * Usage: pnpm run:v3:oracle-baselines-roster10
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isExecutedDirectly } from '../lib/cli-entry.js';

import { createClient } from '@supabase/supabase-js';

import { GATE_DIAGNOSTIC_CASE_IDS } from '../lib/v3/gate-roster.js';
import { loadGateDiagnosticV2Cases } from '../lib/v3/gate-roster.js';
import { scoreV2Run } from '../scorer/v2/index.js';
import { isCaseSuccess } from '../scorer/v2/stats.js';
import { loadHypothesisMatrix, runCaseObayesDb } from '../runners/arm-o-bayes-db.js';
import { runCaseObayes } from '../runners/o-bayes-case.js';
import type { PilotCaseExtended } from '../runners/v2-harness.js';

const HISTORICAL_15 = {
  O_bayes: { conv_at_5: 12 / 15, fraction: '12/15' },
  O_bayes_db: { conv_at_5: 0.25, fraction: '3.75/15 (audit ~4/15)' },
};

function rosterConvAt5(cases: PilotCaseExtended[], records: ReturnType<typeof runCaseObayes>[]) {
  let num = 0;
  for (const r of records) {
    const c = cases.find((x) => x.id === r.case_id);
    if (!c) continue;
    if (isCaseSuccess(c, r) && r.turns <= 5) num++;
  }
  return { numerator: num, denominator: cases.length, rate: num / cases.length };
}

export async function recalibrateOracleBaselinesRoster10() {
  const cases = loadGateDiagnosticV2Cases() as PilotCaseExtended[];
  if (cases.length !== GATE_DIAGNOSTIC_CASE_IDS.length) {
    throw new Error(`Roster gate: attendu ${GATE_DIAGNOSTIC_CASE_IDS.length}, reçu ${cases.length}`);
  }

  const oBayesRecords = cases.map((c) => runCaseObayes(c, 0));
  const oBayesRoster = rosterConvAt5(cases, oBayesRecords);
  const oBayesScores = scoreV2Run(cases, oBayesRecords);

  let oBayesDbRoster: {
    numerator: number;
    denominator: number;
    rate: number;
    status: 'ok' | 'skipped';
    reason?: string;
  } = { numerator: 0, denominator: cases.length, rate: 0, status: 'skipped', reason: 'no_supabase' };
  let oBayesDbScores: ReturnType<typeof scoreV2Run> | null = null;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (supabaseUrl && supabaseKey) {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const allIds = [...new Set(cases.flatMap((c) => c.hypotheses.map((h) => h.id)))];
    const matrix = await loadHypothesisMatrix(supabase, allIds);
    const oBayesDbRecords = cases.map((c) => runCaseObayesDb(c, 0, matrix));
    oBayesDbRoster = { ...rosterConvAt5(cases, oBayesDbRecords), status: 'ok' };
    oBayesDbScores = scoreV2Run(cases, oBayesDbRecords);
  }

  const date = new Date().toISOString().slice(0, 10);
  const report = {
    generated_at: new Date().toISOString(),
    roster: {
      gate_diagnostic_case_ids: [...GATE_DIAGNOSTIC_CASE_IDS],
      count: cases.length,
    },
    historical_15_all_families: HISTORICAL_15,
    O_bayes: {
      roster_10: oBayesRoster,
      scorer_v2_subset: {
        convergence_at_5: oBayesScores.convergence_at_5,
        n: oBayesScores.n,
      },
      per_case: oBayesRecords.map((r) => ({
        case_id: r.case_id,
        path: r.path,
        state: r.final_output.state,
        cause_id: r.cause_id,
        expected: r.true_cause_id,
        turns: r.turns,
        success: isCaseSuccess(cases.find((c) => c.id === r.case_id)!, r) && r.turns <= 5,
      })),
    },
    O_bayes_db: {
      roster_10: oBayesDbRoster,
      scorer_v2_subset: oBayesDbScores
        ? { convergence_at_5: oBayesDbScores.convergence_at_5, n: oBayesDbScores.n }
        : null,
    },
  };

  const outDir = resolve(import.meta.dirname, '../reports');
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, `oracle-baselines-roster10-${date}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');

  console.log(`O_bayes roster-10: ${oBayesRoster.numerator}/${oBayesRoster.denominator} = ${oBayesRoster.rate.toFixed(3)}`);
  if (oBayesDbRoster.status === 'ok') {
    console.log(
      `O_bayes_db roster-10: ${oBayesDbRoster.numerator}/${oBayesDbRoster.denominator} = ${oBayesDbRoster.rate.toFixed(3)}`,
    );
  } else {
    console.warn('O_bayes_db: skipped (Supabase non configuré)');
  }
  console.log(`Rapport: ${outPath}`);

  return { report, outPath };
}

async function main() {
  await recalibrateOracleBaselinesRoster10();
}

if (isExecutedDirectly(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
