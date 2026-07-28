/**
 * Compare rapports de score — A / B vs D (et A vs B).
 *
 * Usage :
 *   tsx scripts/compare-arms.ts --a runs/arm-a/score.json --d baselines/last-green.json
 *   tsx scripts/compare-arms.ts --a … --b runs/arm-b/score.json --d …
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { ScoreReport } from '../scorer/index.js';
import type { Metrics } from '../scorer/aggregate.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function load(path: string): ScoreReport {
  return JSON.parse(readFileSync(resolve(path), 'utf8')) as ScoreReport;
}

function pct(rate: number | null | undefined): string {
  if (rate === null || rate === undefined) return 'n/a';
  return `${(rate * 100).toFixed(1)} %`;
}

function delta(ref: number | null | undefined, other: number | null | undefined): string {
  if (ref === null || ref === undefined || other === null || other === undefined) return 'n/a';
  const diff = (ref - other) * 100;
  const sign = diff >= 0 ? '+' : '';
  return `${sign}${diff.toFixed(1)}`;
}

function metricsOf(report: ScoreReport, slice: 'score_gate' | 'global'): Metrics | undefined {
  return slice === 'score_gate' ? report.slices.score_gate : report.metrics;
}

function printThreeWay(
  label: string,
  a: ScoreReport,
  b: ScoreReport | null,
  d: ScoreReport,
  slice: 'score_gate' | 'global',
) {
  const am = metricsOf(a, slice);
  const bm = b ? metricsOf(b, slice) : null;
  const dm = metricsOf(d, slice);
  if (!am || !dm) return;

  const header = b
    ? '| Métrique | Bras A | Bras B | Bras D | Δ D−A | Δ D−B |'
    : '| Métrique | Bras A | Bras D | Δ D−A |';
  const sep = b ? '|---|---:|---:|---:|---:|---:|' : '|---|---:|---:|---:|';
  console.log(`\n## ${label}`);
  console.log(header);
  console.log(sep);

  const rows: Array<[string, keyof Metrics]> = [
    ['Attribution', 'attribution_rate'],
    ['Utilité (answerable)', 'useful_answer_rate'],
    ['Abstention (no-answer)', 'abstention_rate'],
    ['Hallucination', 'hallucination_rate'],
    ['Format conforme', 'format_compliance_rate'],
  ];

  for (const [labelRow, key] of rows) {
    const aRate = (am[key] as { rate?: number | null } | undefined)?.rate;
    const bRate = bm ? (bm[key] as { rate?: number | null } | undefined)?.rate : null;
    const dRate = (dm[key] as { rate?: number | null } | undefined)?.rate;
    if (b) {
      console.log(
        `| ${labelRow} | ${pct(aRate)} | ${pct(bRate)} | ${pct(dRate)} | ${delta(dRate, aRate)} | ${delta(dRate, bRate)} |`,
      );
    } else {
      console.log(`| ${labelRow} | ${pct(aRate)} | ${pct(dRate)} | ${delta(dRate, aRate)} |`);
    }
  }

  const bPhantom = bm?.phantom_citation_count ?? '—';
  if (b) {
    console.log(
      `| Phantom citations | ${am.phantom_citation_count} | ${bPhantom} | ${dm.phantom_citation_count} | — | — |`,
    );
  } else {
    console.log(`| Phantom citations | ${am.phantom_citation_count} | ${dm.phantom_citation_count} | — |`);
  }
}

function printCvsD(c: ScoreReport, d: ScoreReport, slice: 'score_gate' | 'global') {
  const cm = metricsOf(c, slice);
  const dm = metricsOf(d, slice);
  if (!cm || !dm) return;
  console.log('\n## Bras C vs D (MCP diagnose vs REST assist)');
  console.log('| Métrique | Bras C | Bras D | Δ D−C |');
  console.log('|---|---:|---:|---:|');
  const rows: Array<[string, keyof Metrics]> = [
    ['Attribution', 'attribution_rate'],
    ['Utilité (answerable)', 'useful_answer_rate'],
    ['Citation', 'citation_rate'],
    ['Hallucination', 'hallucination_rate'],
    ['Format conforme', 'format_compliance_rate'],
  ];
  for (const [labelRow, key] of rows) {
    const cRate = (cm[key] as { rate?: number | null } | undefined)?.rate;
    const dRate = (dm[key] as { rate?: number | null } | undefined)?.rate;
    console.log(`| ${labelRow} | ${pct(cRate)} | ${pct(dRate)} | ${delta(dRate, cRate)} |`);
  }
  console.log(`| Phantom citations | ${cm.phantom_citation_count} | ${dm.phantom_citation_count} | — |`);
}

function main() {
  const pathA = arg('a');
  const pathB = arg('b');
  const pathC = arg('c');
  const pathD = arg('d') ?? 'baselines/last-green.json';

  if (pathC && !pathA) {
    const c = load(pathC);
    const d = load(pathD);
    console.log('# Comparatif HVAC Bench — C vs D');
    console.log(`\n- Bras C : ${c.run_id} (${c.arm})`);
    console.log(`- Bras D : ${d.run_id} (${d.arm})`);
    printCvsD(c, d, 'global');
    printCvsD(c, d, 'score_gate');
    return;
  }

  if (!pathA) {
    console.error(
      'Usage: compare-arms --a <score-a> [--b <score-b>] [--d <score-d>]  OR  --c <score-c> --d <score-d>',
    );
    process.exit(1);
  }

  const a = load(pathA);
  const b = pathB ? load(pathB) : null;
  const d = load(pathD);

  console.log('# Comparatif HVAC Bench');
  console.log(`\n- Bras A : ${a.run_id} (${a.arm})`);
  if (b) console.log(`- Bras B : ${b.run_id} (${b.arm})`);
  console.log(`- Bras D : ${d.run_id} (${d.arm})`);

  printThreeWay(`Global (${a.n} cas)`, a, b, d, 'global');
  printThreeWay('score_gate (hors corpus_leakage)', a, b, d, 'score_gate');
  if (a.slices.non_contaminated && d.slices.non_contaminated) {
    console.log('\n## non_contaminated (headline public — exclut forum + corpus_leakage)');
    console.log('| Métrique | Bras A | Bras B | Bras D |');
    console.log('|---|---:|---:|---:|');
    const na = a.slices.non_contaminated;
    const nb = b?.slices.non_contaminated;
    const nd = d.slices.non_contaminated;
    console.log(
      `| Cas | ${na.n} | ${nb?.n ?? '—'} | ${nd.n} |`,
    );
    console.log(
      `| Attribution | ${pct(na.attribution_rate.rate)} | ${pct(nb?.attribution_rate.rate)} | ${pct(nd.attribution_rate.rate)} |`,
    );
    console.log(
      `| Hallucination | ${pct(na.hallucination_rate.rate)} | ${pct(nb?.hallucination_rate.rate)} | ${pct(nd.hallucination_rate.rate)} |`,
    );
  }
}

main();
