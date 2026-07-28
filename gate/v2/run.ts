/**
 * Gate CI v2 — REQ-G2′ (CDC §10)
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { scoreV2Run, type V2Metrics, type V2RunRecord } from '../scorer/v2/index.js';

function loadScore(path: string): V2Metrics {
  return JSON.parse(readFileSync(path, 'utf8')) as V2Metrics;
}

function main() {
  const runDir = resolve(import.meta.dirname, '../../runs/pilot-v2-2026-07-26');
  const d = loadScore(resolve(runDir, 'score-d.json'));
  const raw = readFileSync(resolve(runDir, 'raw.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as V2RunRecord);
  const dRecords = raw.filter((r) => r.arm === 'D');

  const failures: string[] = [];

  if (d.register_violation_rate > 0) {
    failures.push(`register_violation_rate=${d.register_violation_rate} (tolérance zéro)`);
  }
  if (d.n < 40) {
    console.warn(`WARN: n=${d.n} < 40 — gate non décisionnel (REQ-G5′)`);
  }
  if (d.convergence_at_5 < 0.4) {
    failures.push(`convergence@5=${d.convergence_at_5} < 0.40 (S4 gate)`);
  }
  if (d.premature_closure_rate === null) {
    failures.push('premature_closure_rate: no concluded sessions (dénominateur vide)');
  } else if (d.premature_closure_rate > 0.2) {
    failures.push(`premature_closure_rate=${d.premature_closure_rate} > 0.20 (S4 gate)`);
  }
  if (d.wrong_part_rate === null) {
    failures.push('wrong_part_rate: no measurable denominator');
  } else if (d.wrong_part_rate > 0.03) {
    failures.push(`wrong_part_rate=${d.wrong_part_rate}`);
  }

  if (failures.length) {
    console.error('Gate v2 ROUGE:', failures.join('; '));
    process.exit(1);
  }
  console.log('Gate v2 VERT — bras D:', d);
}

main();
