/**
 * Balayage CONCLUSION_THRESHOLD — O_bayes (bénéfice) + D/R local (coût sécurité).
 *
 * ⚠ Ne pas lancer sur D API live : vacuité structurelle tant que max_top_prior(D) < 0,7.
 * Seuil figé à 0,85 avec conclusion_threshold_status=pending_matrix jusqu'à enrichissement matrice.
 *
 * Usage:
 *   pnpm calibrate:conclusion-threshold          # rapport seulement
 *   pnpm check:selector-invariant              # invariant max_top_prior(D) > max_top_prior(R)
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { shouldConclude } from '../lib/bayes-engine.js';
import { runCaseDLocal, runCaseRLocal } from '../lib/prod-session-local.js';
import { runCaseObayes } from '../runners/o-bayes-case.js';
import { loadV2Cases, trueCauseId, type PilotCaseExtended } from '../runners/v2-harness.js';
import { scoreV2Run } from '../scorer/v2/index.js';

const SWEEP_MIN = 0.75;
const SWEEP_MAX = 0.9;
const SWEEP_STEP = 0.005;
const D_PREMATURE_MAX = 0.2;
const PLATEAU_CENTER = 0.795;
const PRIOR_SWEEP_AT = '2026-07-26T21:31:48.858Z';
const POLARITY_FIXES_AT = '2026-07-26T21:31:49.150Z';

type ArmMetrics = {
  conv_at_5: number;
  premature_closure_rate: number | null;
  n_concluded: number;
  max_top_prior: number;
  shadow_premature_at_threshold: number | null;
};

function loadDiagnosableCases(): PilotCaseExtended[] {
  return loadV2Cases().filter(
    (c) => c.meta.family !== 'escalade_legitime' && c.meta.family !== 'hors_corpus',
  ) as PilotCaseExtended[];
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function shadowPrematureRate(
  cases: PilotCaseExtended[],
  run: (c: PilotCaseExtended) => ReturnType<typeof runCaseObayes>,
  threshold: number,
): number | null {
  let shadowConcluded = 0;
  let shadowWrong = 0;

  for (const c of cases) {
    const r = run(c);
    const trace = r.final_output.turn_trace as
      | Array<{ discriminantExecuted: boolean; hypotheses: Array<{ id: string; prior: number }> }>
      | undefined;
    if (!trace?.length) continue;
    const expected = trueCauseId(c);
    for (const step of trace) {
      const { conclude, causeId } = shouldConclude(step.hypotheses, step.discriminantExecuted, threshold);
      if (conclude && causeId) {
        shadowConcluded++;
        if (causeId !== expected) shadowWrong++;
        break;
      }
    }
  }

  return shadowConcluded ? shadowWrong / shadowConcluded : null;
}

function scoreArm(
  cases: PilotCaseExtended[],
  run: (c: PilotCaseExtended) => ReturnType<typeof runCaseObayes>,
  threshold: number,
): ArmMetrics {
  const records = cases.map((c) => run(c));
  const scores = scoreV2Run(cases, records);
  const maxTop = Math.max(
    ...records.map((r) => {
      const sorted = [...(r.hypotheses_final ?? [])].sort((a, b) => b.prior - a.prior);
      return sorted[0]?.prior ?? 0;
    }),
  );
  return {
    conv_at_5: scores.convergence_at_5,
    premature_closure_rate: scores.premature_closure_rate,
    n_concluded: records.filter((r) => r.concluded).length,
    max_top_prior: round3(maxTop),
    shadow_premature_at_threshold: shadowPrematureRate(cases, run, threshold),
  };
}

function sweepAt(cases: PilotCaseExtended[], threshold: number) {
  return {
    threshold: round3(threshold),
    O_bayes: scoreArm(cases, (c) => runCaseObayes(c, 0, { conclusionThreshold: threshold }), threshold),
    D_local: scoreArm(cases, (c) => runCaseDLocal(c, 0, threshold), threshold),
    R_local: scoreArm(cases, (c) => runCaseRLocal(c, 0, threshold), threshold),
  };
}

function prematureOk(
  prem: number | null,
  baseline: number | null,
  nConcluded: number,
): { ok: boolean; vacuous: boolean } {
  if (nConcluded === 0 || prem === null) return { ok: true, vacuous: true };
  if (prem > D_PREMATURE_MAX) return { ok: false, vacuous: false };
  if (baseline !== null && prem > baseline + 1e-9) return { ok: false, vacuous: false };
  return { ok: true, vacuous: false };
}

function main() {
  const pin = process.argv.includes('--pin');
  const acceptVacuous = process.argv.includes('--accept-vacuous-safety');
  const cases = loadDiagnosableCases();
  const baselineAt085 = sweepAt(cases, 0.85);
  const rows = [];
  for (let t = SWEEP_MIN; t <= SWEEP_MAX + 1e-9; t += SWEEP_STEP) {
    rows.push(sweepAt(cases, round3(t)));
  }

  const oMaxConv = Math.max(...rows.map((r) => r.O_bayes.conv_at_5));
  const onPlateau = rows.filter((r) => r.O_bayes.conv_at_5 === oMaxConv);

  let vacuousSafety = false;
  const safe = onPlateau.filter((r) => {
    const d = prematureOk(
      r.D_local.premature_closure_rate,
      baselineAt085.D_local.premature_closure_rate,
      r.D_local.n_concluded,
    );
    const rv = prematureOk(
      r.R_local.premature_closure_rate,
      baselineAt085.R_local.premature_closure_rate,
      r.R_local.n_concluded,
    );
    if (d.vacuous || rv.vacuous) vacuousSafety = true;
    return d.ok && rv.ok;
  });

  const pick =
    safe.length > 0
      ? safe.reduce((best, row) =>
          Math.abs(row.threshold - PLATEAU_CENTER) < Math.abs(best.threshold - PLATEAU_CENTER)
            ? row
            : best,
        )
      : null;

  const report = {
    generated_at: new Date().toISOString(),
    n_diagnosable: cases.length,
    sweep: { min: SWEEP_MIN, max: SWEEP_MAX, step: SWEEP_STEP },
    chronology: {
      prior_sweep_v1_at: PRIOR_SWEEP_AT,
      polarity_8_fixes_at: POLARITY_FIXES_AT,
      delta_ms: 292,
      verdict: 'v1 périmé — polarité hb2-0005/0014 corrigée après le balayage O_bayes seul',
    },
    methodology: {
      O_bayes: 'expert_path — bénéfice seuil uniquement',
      D_local: 'VOI moteur prod (simulateur) — sécurité',
      R_local: 'actions aléatoires seedées — sécurité',
      premature_gate: D_PREMATURE_MAX,
      plateau_center: PLATEAU_CENTER,
      note_vacuite:
        'Si D/R ne concluent pas (premature=null), la contrainte ne mord pas — valider sur bras D API live.',
    },
    baseline_at_0_85: baselineAt085,
    safety_vacuous: vacuousSafety,
    selection: pick
      ? {
          conclusion_threshold: pick.threshold,
          O_bayes_conv_at_5: pick.O_bayes.conv_at_5,
          D_premature: pick.D_local.premature_closure_rate,
          R_premature: pick.R_local.premature_closure_rate,
          D_n_concluded: pick.D_local.n_concluded,
          R_n_concluded: pick.R_local.n_concluded,
        }
      : null,
    curve: rows.map((r) => ({
      threshold: r.threshold,
      O_bayes_conv_at_5: r.O_bayes.conv_at_5,
      O_bayes_premature: r.O_bayes.premature_closure_rate,
      D_conv_at_5: r.D_local.conv_at_5,
      D_premature: r.D_local.premature_closure_rate,
      D_n_concluded: r.D_local.n_concluded,
      D_max_top_prior: r.D_local.max_top_prior,
      D_shadow_premature: r.D_local.shadow_premature_at_threshold,
      R_conv_at_5: r.R_local.conv_at_5,
      R_premature: r.R_local.premature_closure_rate,
      R_n_concluded: r.R_local.n_concluded,
      R_max_top_prior: r.R_local.max_top_prior,
      R_shadow_premature: r.R_local.shadow_premature_at_threshold,
    })),
  };

  const reportsDir = resolve(import.meta.dirname, '../reports');
  mkdirSync(reportsDir, { recursive: true });
  const outPath = resolve(reportsDir, 'conclusion-threshold-sweep-2026-07-26.json');
  writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');

  console.log('=== Chronologie ===');
  console.log(`Sweep v1: ${PRIOR_SWEEP_AT}`);
  console.log(`8 corrections polarité: ${POLARITY_FIXES_AT} (+292 ms) — v1 invalide\n`);

  console.log('T\tO_conv\tO_prem\tD_n\tD_prem\tD_maxP\tR_n\tR_prem\tR_maxP');
  for (const r of report.curve.filter((_, i) => i % 4 === 0)) {
    console.log(
      `${r.threshold}\t${r.O_bayes_conv_at_5}\t${r.O_bayes_premature}\t${r.D_n_concluded}\t${r.D_premature}\t${r.D_max_top_prior}\t${r.R_n_concluded}\t${r.R_premature}\t${r.R_max_top_prior}`,
    );
  }

  if (vacuousSafety) {
    console.log(
      '\n⚠ D/R local : 0 conclusion sur la plage — premature=null (contrainte vacuite, comme D API live).',
    );
    console.log('  Validation sécurité requise sur bras D API avant pin production.');
  }

  if (!pick) {
    console.error('\nAucun seuil sur plateau O_bayes ne passe les filtres D/R.');
    process.exit(1);
  }

  console.log(`\nRecommandation plateau: T=${pick.threshold} (centre ${PLATEAU_CENTER})`);
  console.log(`  O_bayes conv@5=${pick.O_bayes_conv_at_5}`);
  console.log(`Rapport: ${outPath}`);

  if (!pin) {
    console.log('\nConfig inchangée. Pin: pnpm calibrate:conclusion-threshold -- --pin [--accept-vacuous-safety]');
    return;
  }

  if (vacuousSafety && !acceptVacuous) {
    console.error('\nRefus pin : sécurité D/R vacuite. Ajouter --accept-vacuous-safety ou valider D API live.');
    process.exit(1);
  }

  const configPath = resolve(import.meta.dirname, '../config/likelihoods-v2.json');
  const webConfigPath = resolve(
    import.meta.dirname,
    '../../AskMarcel-WebApp-NextJS/lib/diagnostic-v2/likelihoods-v2.json',
  );
  const calibration = {
    fitted_on: 'pilot' as const,
    fitted_at: report.generated_at,
    sweep: report.sweep,
    premature_closure_rate_max: D_PREMATURE_MAX,
    conv_at_5_at_fit: pick.O_bayes.conv_at_5,
    safety_arms: ['D_local', 'R_local'],
    safety_vacuous: vacuousSafety,
    plateau_center: PLATEAU_CENTER,
    notes: vacuousSafety
      ? 'Pin avec sécurité D/R vacuite — confirmer sur D API live avant prod.'
      : 'Seuil milieu plateau sous contrainte D/R.',
  };

  for (const p of [configPath, webConfigPath]) {
    const cfg = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
    cfg.conclusion_threshold = pick.threshold;
    cfg.calibration = calibration;
    delete cfg.calibration_pending;
    writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n');
  }
  console.log(`\nPinné conclusion_threshold=${pick.threshold}`);
}

main();
