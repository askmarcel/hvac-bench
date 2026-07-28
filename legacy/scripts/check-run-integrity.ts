/**
 * Garde-fous anti-dégénérescence — Phase 2c (post-S1)
 *
 * Après suppression du tie-break UUID (S1), distinct_path_ratio et H(1re action)
 * ne sont plus des indicateurs de dégénérescence — le sélecteur est déterministe.
 *
 * Invariants actifs :
 * - ESC-* interdit en path / next_action
 * - expert_path_first_hit_rate > 0 (le moteur ne minimise plus uniquement le coût)
 *
 * Usage: pnpm check-run-integrity -- --run-dir runs/<id> [--arm D]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { distinctPathRatio, entropyBits, firstActions } from '../scorer/v2/stats.js';
import { aggregateOracleMetrics } from '../scorer/v2/oracle-metrics.js';
import type { V2RunRecord } from '../scorer/v2/types.js';
import { loadV2Cases } from '../runners/v2-harness.js';

export type IntegrityReport = {
  status: 'green' | 'red';
  arm: string;
  n_records: number;
  n_cases: number;
  esc_in_next_action: number;
  distinct_path_ratio: number;
  first_action_entropy_bits: number;
  expert_path_first_hit_rate: number;
  failures: string[];
  informational: string[];
};

function loadRecords(runDir: string, arm?: string): V2RunRecord[] {
  const raw = readFileSync(resolve(runDir, 'raw.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as V2RunRecord);
  return arm ? raw.filter((r) => r.arm === arm) : raw;
}

function countEscInNextAction(records: V2RunRecord[]): number {
  let n = 0;
  for (const r of records) {
    for (const aid of r.path) {
      if (aid.startsWith('ESC-')) n++;
    }
    const next = r.final_output.next_action;
    if (typeof next === 'string' && next.startsWith('ESC-')) n++;
  }
  return n;
}

export function checkRunIntegrity(runDir: string, arm = 'D'): IntegrityReport {
  const records = loadRecords(runDir, arm);
  const failures: string[] = [];
  const informational: string[] = [];
  const escCount = countEscInNextAction(records);
  const caseIds = new Set(records.map((r) => r.case_id));
  const nCases = caseIds.size || 1;

  if (escCount > 0) {
    failures.push(`ESC-* en next_action ou path : ${escCount} (invariant = 0)`);
  }

  const dpr = distinctPathRatio(records);
  const faCounts = firstActions(records);
  const hFirst = entropyBits(faCounts);

  informational.push(
    `distinct_paths/n_cases = ${dpr.toFixed(2)} (informatif post tie-break déterministe)`,
  );
  informational.push(`H(première action) = ${hFirst.toFixed(2)} bits (informatif)`);

  const cases = loadV2Cases();
  const oracle = aggregateOracleMetrics(cases, records);

  if (oracle.expert_path_first_hit_rate <= 0 && records.length > 0) {
    failures.push(
      `expert_path_first_hit_rate = ${oracle.expert_path_first_hit_rate.toFixed(2)} — sélecteur ne touche jamais le chemin expert`,
    );
  }

  return {
    status: failures.length ? 'red' : 'green',
    arm,
    n_records: records.length,
    n_cases: nCases,
    esc_in_next_action: escCount,
    distinct_path_ratio: dpr,
    first_action_entropy_bits: hFirst,
    expert_path_first_hit_rate: oracle.expert_path_first_hit_rate,
    failures,
    informational,
  };
}

function main() {
  const args = process.argv.slice(2);
  const runIdx = args.indexOf('--run-dir');
  const armIdx = args.indexOf('--arm');
  const runDir = runIdx >= 0 ? resolve(args[runIdx + 1]!) : resolve(import.meta.dirname, '../runs');
  const arm = armIdx >= 0 ? args[armIdx + 1]! : 'D';

  if (!existsSync(resolve(runDir, 'raw.jsonl'))) {
    console.error(`raw.jsonl introuvable dans ${runDir}`);
    process.exit(1);
  }

  const report = checkRunIntegrity(runDir, arm);
  writeFileSync(resolve(runDir, 'integrity.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));

  if (report.status !== 'green') {
    process.exit(1);
  }
}

main();
