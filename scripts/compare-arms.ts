/**
 * Compare deux rapports de score (ex. bras A vs bras D).
 *
 * Usage :
 *   tsx scripts/compare-arms.ts --a runs/arm-a/score.json --d baselines/last-green.json
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { ScoreReport } from '../scorer/index.js';

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

function delta(a: number | null | undefined, d: number | null | undefined): string {
  if (a === null || a === undefined || d === null || d === undefined) return 'n/a';
  const diff = (d - a) * 100;
  const sign = diff >= 0 ? '+' : '';
  return `${sign}${diff.toFixed(1)} pts (D−A)`;
}

function printSlice(label: string, a: ScoreReport, d: ScoreReport, slice: 'score_gate' | 'global') {
  const am = slice === 'score_gate' ? a.slices.score_gate : a.metrics;
  const dm = slice === 'score_gate' ? d.slices.score_gate : d.metrics;
  if (!am || !dm) return;

  console.log(`\n## ${label}`);
  console.log('| Métrique | Bras A | Bras D | Δ D−A |');
  console.log('|---|---:|---:|---:|');

  const rows: Array<[string, keyof typeof am]> = [
    ['Attribution', 'attribution_rate'],
    ['Utilité (answerable)', 'useful_answer_rate'],
    ['Abstention (no-answer)', 'abstention_rate'],
    ['Hallucination', 'hallucination_rate'],
    ['Format conforme', 'format_compliance_rate'],
  ];

  for (const [labelRow, key] of rows) {
    const aRate = (am[key] as { rate?: number | null } | undefined)?.rate;
    const dRate = (dm[key] as { rate?: number | null } | undefined)?.rate;
    console.log(`| ${labelRow} | ${pct(aRate)} | ${pct(dRate)} | ${delta(aRate, dRate)} |`);
  }

  console.log(`| High-conf errors | ${am.high_confidence_error_count} | ${dm.high_confidence_error_count} | — |`);
  console.log(`| Phantom citations | ${am.phantom_citation_count} | ${dm.phantom_citation_count} | — |`);
}

function main() {
  const pathA = arg('a');
  const pathD = arg('d') ?? 'baselines/last-green.json';
  if (!pathA) {
    console.error('Usage: tsx scripts/compare-arms.ts --a <score-a.json> [--d <score-d.json>]');
    process.exit(1);
  }

  const a = load(pathA);
  const d = load(pathD);

  console.log('# Comparatif HVAC Bench — Bras A vs D');
  console.log(`\n- Bras A : run ${a.run_id} · n=${a.n}`);
  console.log(`- Bras D : run ${d.run_id} · n=${d.n}`);

  printSlice('Global (52 cas)', a, d, 'global');
  printSlice('score_gate (hors corpus_leakage)', a, d, 'score_gate');
  if (a.slices.score_leak && d.slices.score_leak) {
    console.log('\n## score_leak (signal)');
    console.log(
      `Utilité A ${pct(a.slices.score_leak.useful_answer_rate?.rate)} · D ${pct(d.slices.score_leak.useful_answer_rate?.rate)}`,
    );
  }
}

main();
