/**
 * Compare D vs B vs E — Phase 7 (CDC §8.10) — révision calibration v2
 *
 * Usage: pnpm run:v2:compare -- --run-dir runs/<run-id>
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { checkRunIntegrity } from './check-run-integrity.js';
import {
  aggregateByCase,
  isCaseSuccess,
  mutualInformation,
  pass3Rate,
  wilsonCI,
} from '../scorer/v2/stats.js';
import { loadV2Cases } from '../runners/v2-harness.js';
import type { V2Metrics } from '../scorer/v2/types.js';

function mcnemarP(b: number, c: number): number {
  const n = b + c;
  if (n === 0) return 1;
  const chi2 = ((Math.abs(b - c) - 1) ** 2) / n;
  const z = Math.sqrt(chi2);
  const p = 2 * (1 - normalCdf(z));
  return Math.min(1, Math.max(0, p));
}

function normalCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * Math.abs(x));
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

type RawRec = {
  case_id: string;
  arm: string;
  replicate: number;
  concluded: boolean;
  cause_id: string | null;
  true_cause_id: string;
  path: string[];
};

function fmtPct(v: number | null | undefined): string {
  if (v == null) return 'n/a';
  return `${(v * 100).toFixed(1)}%`;
}

function fmtCI(ci: { low: number; high: number } | null | undefined): string {
  if (!ci) return '';
  return ` [${(ci.low * 100).toFixed(1)}–${(ci.high * 100).toFixed(1)}%]`;
}

function rDisqualifies(r: V2Metrics, real: V2Metrics): string[] {
  const bad: string[] = [];
  const keys: Array<keyof V2Metrics> = [
    'convergence_at_5',
    'convergence_at_3',
    'top3_accuracy',
  ];
  for (const k of keys) {
    const rv = r[k];
    const tv = real[k];
    if (typeof rv === 'number' && typeof tv === 'number' && rv > tv) {
      bad.push(String(k));
    }
  }
  return bad;
}

function main() {
  const args = process.argv.slice(2);
  const runIdx = args.indexOf('--run-dir');
  const defaultDir = resolve(import.meta.dirname, '../runs/pilot-v2-live-2026-07-26');
  const runDir = runIdx >= 0 ? resolve(args[runIdx + 1] ?? defaultDir) : defaultDir;

  const manifestPath = resolve(runDir, 'manifest.json');
  const calPath = resolve(runDir, 'calibration.json');
  const integrityPath = resolve(runDir, 'integrity.json');

  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { mode?: string };
    if (manifest.mode === 'oracle_smoke') {
      console.error('REFUSÉ : run oracle_smoke.');
      process.exit(1);
    }
  }

  if (!existsSync(calPath)) {
    console.error('REFUSÉ : calibration.json absent — exécuter pnpm run:v2:calibrate d\'abord.');
    process.exit(1);
  }
  const calibration = JSON.parse(readFileSync(calPath, 'utf8')) as { status?: string };
  if (calibration.status !== 'green') {
    console.error('REFUSÉ : calibration.status !== green');
    process.exit(1);
  }

  let integrity = existsSync(integrityPath)
    ? (JSON.parse(readFileSync(integrityPath, 'utf8')) as { status: string })
    : null;
  if (!integrity) {
    const check = checkRunIntegrity(runDir, 'D');
    writeFileSync(integrityPath, JSON.stringify(check, null, 2) + '\n');
    integrity = check;
  }
  if (integrity.status !== 'green') {
    console.error('REFUSÉ : intégrité rouge —', (integrity as { failures?: string[] }).failures);
    process.exit(1);
  }

  const d = JSON.parse(readFileSync(resolve(runDir, 'score-d.json'), 'utf8')) as V2Metrics;
  const b = JSON.parse(readFileSync(resolve(runDir, 'score-b.json'), 'utf8')) as V2Metrics;
  const e = JSON.parse(readFileSync(resolve(runDir, 'score-e.json'), 'utf8')) as V2Metrics;
  const rScore = existsSync(resolve(runDir, 'score-r.json'))
    ? (JSON.parse(readFileSync(resolve(runDir, 'score-r.json'), 'utf8')) as V2Metrics)
    : null;

  const raw = readFileSync(resolve(runDir, 'raw.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as RawRec);

  const cases = loadV2Cases();
  const dAgg = aggregateByCase(raw as never, 'D', cases);
  const bAgg = aggregateByCase(raw as never, 'B', cases);
  const eAgg = aggregateByCase(raw as never, 'E', cases);
  const dPass3 = pass3Rate(dAgg);
  const bPass3 = pass3Rate(bAgg);
  const ePass3 = pass3Rate(eAgg);

  const caseIds = [...new Set(raw.map((r) => r.case_id))];
  let dbBoth = 0;
  let dOnly = 0;
  let bOnly = 0;
  for (const cid of caseIds) {
    const dOk = dAgg.find((a) => a.case_id === cid)?.pass3 ?? false;
    const bOk = bAgg.find((a) => a.case_id === cid)?.pass3 ?? false;
    if (dOk && bOk) dbBoth++;
    else if (dOk) dOnly++;
    else if (bOk) bOnly++;
  }
  const pDb = mcnemarP(dOnly, bOnly);
  const discordant = dOnly + bOnly;

  const dRecords = raw.filter((r) => r.arm === 'D');
  const mi = mutualInformation(
    dRecords.map((r) => ({ x: r.case_id, y: r.path[0] ?? '__empty__' })),
  );

  let status: 'INTERPRETABLE' | 'INSUFFISANT' | 'NON_TESTE' = 'INTERPRETABLE';
  const floor = 0.05;
  if (dPass3 < floor && bPass3 < floor && ePass3 < floor) status = 'INSUFFISANT';

  const disqD = rScore ? rDisqualifies(rScore, d) : [];
  const disqB = rScore ? rDisqualifies(rScore, b) : [];
  const disqE = rScore ? rDisqualifies(rScore, e) : [];

  let verdict = '';
  const dStarPath = resolve(import.meta.dirname, '../runs/manifest-d-star.json');
  let dStarSection = '';
  if (existsSync(dStarPath)) {
    const dStar = JSON.parse(readFileSync(dStarPath, 'utf8')) as {
      priors_source?: string;
      total_rows?: number;
    };
    dStarSection = `
## Bras D* (priors assistés)

- \`priors_source\` : ${dStar.priors_source ?? 'pilot_cases'}
- Lignes semées : ${dStar.total_rows ?? 'n/a'}
- Écart **D* − D** : mesurer \`convergence_at_5\` et \`expert_path_first_hit_rate\` après run D* post-seed (non mélangé avec D nominal).
`;
  }

  if (status === 'INSUFFISANT') {
    verdict = 'INSUFFISANT — tous les bras au plancher malgré calibration verte. Mesurer discordance puis dimensionner corpus.';
  } else if (dPass3 >= bPass3 && dPass3 >= ePass3) {
    verdict = 'D favorable ou équivalent (pass^3) — Phase 7 conditionnellement atteinte sur pilote.';
  } else {
    verdict = 'D perdant vs B/E (pass^3) — résultat interprétable pour roadmap interne.';
  }

  const report = `# Run pilote v2 — D vs B vs E (calibration v2)

Date : ${new Date().toISOString().slice(0, 10)}  
Statut run : **${status}**  
Calibration : ${calibration.status} | Intégrité D : ${integrity.status}

## Métriques headline (scorer ${d.scorer_version ?? '0.2.0'})

| Bras | conv@3 | conv@5 | pass^3 (cas) | top3 | path_cost (n) | prem. closure† |
|------|-------:|-------:|-------------:|-----:|--------------:|---------------:|
| D | ${fmtPct(d.convergence_at_3)}${fmtCI(d.convergence_at_3_ci)} | ${fmtPct(d.convergence_at_5)}${fmtCI(d.convergence_at_5_ci)} | ${fmtPct(dPass3)} | ${fmtPct(d.top3_accuracy)} | ${d.path_cost_ratio_median ?? 'n/a'} (n=${d.path_cost_ratio_n}) | ${fmtPct(d.premature_closure_rate)} |
| B | ${fmtPct(b.convergence_at_3)} | ${fmtPct(b.convergence_at_5)} | ${fmtPct(bPass3)} | ${fmtPct(b.top3_accuracy)} | ${b.path_cost_ratio_median ?? 'n/a'} (n=${b.path_cost_ratio_n}) | ${fmtPct(b.premature_closure_rate)} |
| E | ${fmtPct(e.convergence_at_3)} | ${fmtPct(e.convergence_at_5)} | ${fmtPct(ePass3)} | ${fmtPct(e.top3_accuracy)} | ${e.path_cost_ratio_median ?? 'n/a'} (n=${e.path_cost_ratio_n}) | ${fmtPct(e.premature_closure_rate)} |

† Dénominateur = sessions conclues (v0.2.0)

## Tests appariés (niveau cas, pass^3)

- McNemar D vs B : p = ${pDb.toFixed(3)} (discordant=${discordant}, D-only=${dOnly}, B-only=${bOnly})
- I(case_id ; 1ère action) bras D : ${mi.toFixed(3)}

## Règle baseline R

${rScore ? `Métriques disqualifiées si R > bras réel : D=[${disqD.join(', ') || '—'}], B=[${disqB.join(', ') || '—'}], E=[${disqE.join(', ') || '—'}]` : 'score-r.json absent'}

## Verdict

${verdict}

${dStarSection}
## Clause lucidité + calibration

Aucune publication externe avant held-out dimensionné **après** mesure du taux discordant réel.  
Un verdict n'est recevable que si calibration verte + intégrité verte.
`;

  const outPath = resolve(import.meta.dirname, '../reports/pilot-v2-D-vs-B-vs-E.md');
  writeFileSync(outPath, report);
  console.log(report);
  console.log(`\nWrote ${outPath}`);
}

main();
