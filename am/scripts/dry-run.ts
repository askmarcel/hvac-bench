#!/usr/bin/env tsx
/**
 * am:dry-run — T10 : 2 cas dev × 3 bras × 1 réplicat, puis score + rapport.
 *
 * Usage:
 *   pnpm am:dry-run
 *   pnpm am:dry-run --cases ham-0001,ham-0002
 *
 * Prérequis : AM_HARNESS_BEARER_TOKEN, AM_SIM_*, WebApp sur AM_HARNESS_URL.
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const HVAC_BENCH_ROOT = resolve(import.meta.dirname, '../..');
const AM_REPORTS = resolve(HVAC_BENCH_ROOT, 'am/reports');

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function run(cmd: string) {
  console.log(`\n▶ ${cmd}\n`);
  execSync(cmd, { cwd: HVAC_BENCH_ROOT, stdio: 'inherit', env: process.env });
}

function main() {
  if (!process.env.AM_HARNESS_BEARER_TOKEN) {
    console.error('🚫 AM_HARNESS_BEARER_TOKEN requis pour le dry-run E2E.');
    process.exit(2);
  }

  const cases = arg('cases') ?? 'ham-0001,ham-0002';
  const date = new Date().toISOString().slice(0, 10);
  mkdirSync(AM_REPORTS, { recursive: true });

  const scorePaths: string[] = [];

  for (const arm of ['L0', 'LW', 'PROD'] as const) {
    run(
      `pnpm exec tsx am/runner/run-arm.ts --arm ${arm} --split dev --replicates 1 --cases ${cases}`,
    );
    const runsDir = resolve(HVAC_BENCH_ROOT, 'runs');
    const latest = execSync(`ls -1t ${runsDir} | head -1`, { encoding: 'utf8' }).trim();
    const runPath = resolve(runsDir, latest);
    if (!existsSync(resolve(runPath, 'raw.jsonl'))) {
      console.error(`Run ${latest} sans raw.jsonl — dry-run incomplet.`);
      process.exit(2);
    }
    run(`pnpm am:score --run ${runPath}`);
    scorePaths.push(resolve(runPath, 'score.json'));
  }

  const reportPath = resolve(AM_REPORTS, `dry-run-${date}.md`);
  run(`pnpm am:report --scores ${scorePaths.join(' ')} --out ${reportPath}`);
  console.log(`\n✅ Dry-run terminé — rapport: ${reportPath}`);
}

main();
