/**
 * Gate S2 — forme + information des priors (audit v3 recovery).
 *
 * Usage:
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... pnpm check:s2-priors
 *   pnpm check:s2-priors -- --fixture
 */
import {
  finalizeSignaturePriors,
  isRealCauseHypothesis,
  prepareCountsForSmoothing,
  shannonEntropyBits,
  capAndRenormalizePriors,
  applyDirichletSmoothing,
} from '../../AskMarcel-WebApp-NextJS/lib/diagnostic-v2/canonical-hypotheses';

export type S2Health = {
  sig_singleton: number;
  sig_total: number;
  avg_hyp_per_sig: number;
  priors_above_cap: number;
  pct_signatures_sans_cause_reelle: number;
  entropie_mediane: number;
};

const MAX_PCT_SANS_CAUSE_REELLE = 5;
const MIN_ENTROPIE_MEDIANE = 2;

export function evaluateRows(
  rows: Array<{ signature: string; hypothesis_id: string; prior: number; n_observations?: number }>,
): S2Health {
  const bySig = new Map<string, Array<{ hypothesis_id: string; prior: number }>>();
  let priorsAboveCap = 0;
  for (const r of rows) {
    const arr = bySig.get(r.signature) ?? [];
    arr.push({ hypothesis_id: r.hypothesis_id, prior: r.prior });
    bySig.set(r.signature, arr);
    if (r.prior > 0.85) priorsAboveCap++;
  }

  const entropies: number[] = [];
  let sansCauseReelle = 0;
  for (const [, hyps] of bySig) {
    const hasReal = hyps.some((h) => isRealCauseHypothesis(h.hypothesis_id));
    if (!hasReal) sansCauseReelle++;
    const priorMap = new Map(hyps.map((h) => [h.hypothesis_id, h.prior]));
    entropies.push(shannonEntropyBits(priorMap));
  }

  entropies.sort((a, b) => a - b);
  const median =
    entropies.length === 0
      ? 0
      : entropies.length % 2 === 1
        ? entropies[(entropies.length - 1) / 2]!
        : (entropies[entropies.length / 2 - 1]! + entropies[entropies.length / 2]!) / 2;

  const sigSingleton = [...bySig.values()].filter((h) => h.length === 1).length;
  const avgHyp =
    bySig.size > 0 ? [...bySig.values()].reduce((s, h) => s + h.length, 0) / bySig.size : 0;

  return {
    sig_singleton: sigSingleton,
    sig_total: bySig.size,
    avg_hyp_per_sig: Math.round(avgHyp * 10) / 10,
    priors_above_cap: priorsAboveCap,
    pct_signatures_sans_cause_reelle:
      bySig.size > 0 ? Math.round((1000 * sansCauseReelle) / bySig.size) / 10 : 0,
    entropie_mediane: Math.round(median * 100) / 100,
  };
}

export function assertS2(health: S2Health, label: string): string[] {
  const failures: string[] = [];
  if (health.sig_singleton > 0) {
    failures.push(`${label}: sig_singleton=${health.sig_singleton} (cible 0)`);
  }
  if (health.priors_above_cap > 0) {
    failures.push(`${label}: priors_above_cap=${health.priors_above_cap} (cible 0)`);
  }
  if (health.avg_hyp_per_sig < 2 && health.sig_total > 0) {
    failures.push(`${label}: avg_hyp_per_sig=${health.avg_hyp_per_sig} (cible >= 2)`);
  }
  if (health.pct_signatures_sans_cause_reelle > MAX_PCT_SANS_CAUSE_REELLE) {
    failures.push(
      `${label}: pct_signatures_sans_cause_reelle=${health.pct_signatures_sans_cause_reelle}% (cible <= ${MAX_PCT_SANS_CAUSE_REELLE}%)`,
    );
  }
  if (health.entropie_mediane < MIN_ENTROPIE_MEDIANE && health.sig_total > 0) {
    failures.push(
      `${label}: entropie_mediane=${health.entropie_mediane} (cible >= ${MIN_ENTROPIE_MEDIANE})`,
    );
  }
  return failures;
}

function runFixtureTest(): void {
  const badSingleton = [{ signature: 'a', hypothesis_id: 'pression_basse', prior: 1, n_observations: 100 }];
  if (assertS2(evaluateRows(badSingleton), 'fixture-singleton').length === 0) {
    console.error('FAIL: singleton non détecté');
    process.exit(1);
  }
  console.log('OK fixture-singleton');

  const fillerOnly = finalizeSignaturePriors(new Map([['cause_inconnue', 5]]), {
    signature: 'filler',
    windowStart: '2026-01-01',
    windowEnd: '2026-07-26',
  });
  const fillerHealth = evaluateRows(fillerOnly);
  if (assertS2(fillerHealth, 'fixture-filler').length === 0) {
    console.error('FAIL: filler-only devrait violer gate information');
    process.exit(1);
  }
  console.log('OK fixture-filler: sans cause réelle →', fillerHealth);

  const realCounts = new Map([
    ['pression_basse', 24],
    ['air_circuit', 34],
    ['pompe_grippee', 20],
    ['flowswitch_hs', 12],
    ['filtre_colmate', 8],
  ]);
  const realRows = finalizeSignaturePriors(realCounts, {
    signature: 'real',
    windowStart: '2026-01-01',
    windowEnd: '2026-07-26',
  });
  const realHealth = evaluateRows(realRows);
  if (assertS2(realHealth, 'fixture-real').length > 0) {
    console.error('FAIL: distribution réelle devrait passer:', assertS2(realHealth, 'fixture-real'));
    process.exit(1);
  }
  const ent = shannonEntropyBits(
    capAndRenormalizePriors(applyDirichletSmoothing(prepareCountsForSmoothing(realCounts))),
  );
  if (ent < MIN_ENTROPIE_MEDIANE) {
    console.error('FAIL: entropie réelle trop basse', ent);
    process.exit(1);
  }
  console.log('OK fixture-real:', realHealth, 'entropy', ent.toFixed(2));
}

async function runLiveCheck(): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
  }

  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(supabaseUrl, supabaseKey);

  const { data: viewRow, error: viewErr } = await supabase
    .from('diag_priors_s2_health')
    .select('*')
    .single();
  if (!viewErr && viewRow) {
    const health: S2Health = {
      sig_singleton: viewRow.sig_singleton ?? 0,
      sig_total: viewRow.sig_total ?? 0,
      avg_hyp_per_sig: Number(viewRow.avg_hyp_per_sig ?? 0),
      priors_above_cap: viewRow.priors_above_cap ?? 0,
      pct_signatures_sans_cause_reelle: Number(viewRow.pct_signatures_sans_cause_reelle ?? 100),
      entropie_mediane: Number(viewRow.entropie_mediane ?? 0),
    };
    console.log('S2 health (vue):', health);
    const failures = assertS2(health, 'live');
    if (failures.length) {
      console.error('S2 GATE ROUGE:', failures.join('; '));
      process.exit(1);
    }
    console.log('S2 GATE VERT');
    return;
  }

  const { data, error } = await supabase
    .from('diag_priors')
    .select('signature, hypothesis_id, prior, n_observations');
  if (error) throw error;
  const health = evaluateRows(data ?? []);
  console.log('S2 health (computed):', health);
  const failures = assertS2(health, 'live');
  if (failures.length) {
    console.error('S2 GATE ROUGE:', failures.join('; '));
    process.exit(1);
  }
  console.log('S2 GATE VERT');
}

async function main() {
  runFixtureTest();
  if (!process.argv.includes('--fixture')) {
    await runLiveCheck();
  }
}

const isCli =
  process.argv[1]?.endsWith('check-s2-priors.ts') ||
  process.argv[1]?.endsWith('check-s2-priors');
if (isCli) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
