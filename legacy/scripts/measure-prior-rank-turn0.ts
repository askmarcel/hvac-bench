/**
 * Mesure bloquante : rang de la vraie cause au tour 0 (priors production, avant action).
 *
 * Usage:
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... pnpm measure:prior-rank-turn0
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createClient } from '@supabase/supabase-js';

import { loadProductionPriors } from '../lib/load-production-priors.js';
import { loadV2Cases, trueCauseId } from '../runners/v2-harness.js';
import { rankOf } from '../scorer/v2/directional-metrics.js';

type PilotCase = ReturnType<typeof loadV2Cases>[number] & {
  context: { equipment_type: string };
  symptom: { code_present: string | null };
};

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const cases = loadV2Cases() as PilotCase[];
  const rows: Array<{
    case_id: string;
    family: string;
    true_cause_id: string;
    rank_turn_0: number;
    n_hypotheses: number;
    true_cause_prior: number;
    top_cause_id: string;
    prior_source: string;
    signature: string;
  }> = [];

  for (const c of cases) {
    const trueId = trueCauseId(c);
    const { hypotheses, signature, source } = await loadProductionPriors(
      supabase,
      c.context.equipment_type,
      c.symptom.code_present,
    );
    const ranked = hypotheses.map((h) => ({ id: h.id, prior: h.prior }));
    const rank = rankOf(ranked, trueId);
    const sorted = [...ranked].sort((a, b) => b.prior - a.prior);
    rows.push({
      case_id: c.id,
      family: c.meta.family,
      true_cause_id: trueId,
      rank_turn_0: rank,
      n_hypotheses: ranked.length,
      true_cause_prior: ranked.find((h) => h.id === trueId)?.prior ?? 0,
      top_cause_id: sorted[0]?.id ?? '',
      prior_source: source,
      signature,
    });
  }

  const diagnosable = rows.filter(
    (r) => r.family !== 'escalade_legitime' && r.family !== 'hors_corpus',
  );
  const ranks = diagnosable.map((r) => r.rank_turn_0);
  const mean = ranks.reduce((a, b) => a + b, 0) / (ranks.length || 1);
  const med = median(ranks);
  const top3 = ranks.filter((r) => r <= 3).length / (ranks.length || 1);
  const at1 = ranks.filter((r) => r === 1).length;

  const report = {
    measured_at: new Date().toISOString(),
    n_cases_total: rows.length,
    n_diagnosable: diagnosable.length,
    mean_true_cause_rank_turn0: Math.round(mean * 100) / 100,
    median_true_cause_rank_turn0: med,
    top3_rate_turn0: Math.round(top3 * 1000) / 1000,
    rank1_count: at1,
    verdict:
      med <= 3
        ? 'GO — prior discriminant (médiane ≤ 3), enchaîner cascade'
        : med <= 8
          ? 'WARN — prior faible (médiane 4-8), ré-injecter signal code/marque/saison'
          : 'STOP — prior quasi-uniforme, ne pas relancer cascade',
    cases: rows,
  };

  const outDir = resolve(import.meta.dirname, '../reports');
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, `prior-rank-turn0-${new Date().toISOString().slice(0, 10)}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');

  console.log('=== Rang vraie cause au tour 0 (priors production) ===');
  console.log(`Diagnostiquables: ${diagnosable.length}/${rows.length}`);
  console.log(`Moyenne: ${report.mean_true_cause_rank_turn0} | Médiane: ${med} | Top-3: ${(top3 * 100).toFixed(1)}% | Rang#1: ${at1}`);
  console.log(`Verdict: ${report.verdict}`);
  console.log('\nDétail:');
  for (const r of rows) {
    console.log(
      `  ${r.case_id} (${r.family}): rang=${r.rank_turn_0}/${r.n_hypotheses} true=${r.true_cause_id} top=${r.top_cause_id} prior_true=${r.true_cause_prior.toFixed(3)} [${r.prior_source}]`,
    );
  }
  console.log(`\nRapport: ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
