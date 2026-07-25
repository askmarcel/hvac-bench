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

function main() {
  const pathA = arg('a');
  const pathB = arg('b');
  const pathD = arg('d') ?? 'baselines/last-green.json';
  if (!pathA) {
    console.error('Usage: tsx scripts/compare-arms.ts --a <score-a.json> [--b <score-b.json>] [--d <score-d.json>]');
    process.exit(1);
  }

  const a = load(pathA);
  const b = pathB ? load(pathB) : null;
  const d = load(pathD);

  console.log('# Comparatif HVAC Bench');
  console.log(`\n- Bras A : ${a.run_id} (${a.arm})`);
  if (b) console.log(`- Bras B : ${b.run_id} (${b.arm})`);
  console.log(`- Bras D : ${d.run_id} (${d.arm})`);

  printThreeWay('Global (52 cas)', a, b, d, 'global');
  printThreeWay('score_gate (hors corpus_leakage)', a, b, d, 'score_gate');
}

main();
