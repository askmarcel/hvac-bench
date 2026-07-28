#!/usr/bin/env tsx
/**
 * T11 — run complet split dev (10 cas × 3 bras × 3 réplicats) + scores + rapport.
 * T12 — idem avec --split gate (via am:run-gate).
 *
 * Usage:
 *   pnpm am:run-iteration --split dev
 *   pnpm am:run-iteration --split gate
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

function latestRunDir(): string {
  const runsDir = resolve(HVAC_BENCH_ROOT, 'runs');
  const latest = execSync(`ls -1t ${runsDir} | head -1`, { encoding: 'utf8' }).trim();
  return resolve(runsDir, latest);
}

function main() {
  if (!process.env.AM_HARNESS_BEARER_TOKEN) {
    console.error('🚫 AM_HARNESS_BEARER_TOKEN requis.');
    process.exit(2);
  }

  const split = arg('split') ?? 'dev';
  if (split !== 'dev' && split !== 'gate') {
    console.error('--split doit être dev ou gate');
    process.exit(1);
  }

  const date = new Date().toISOString().slice(0, 10);
  mkdirSync(AM_REPORTS, { recursive: true });
  const scorePaths: string[] = [];

  for (const arm of ['L0', 'LW', 'PROD'] as const) {
    run(
      `pnpm exec tsx am/runner/run-arm.ts --arm ${arm} --split ${split} --replicates 3`,
    );
    const runPath = latestRunDir();
    if (!existsSync(resolve(runPath, 'raw.jsonl'))) {
      console.error(`Run sans raw.jsonl — arrêt.`);
      process.exit(2);
    }
    run(`pnpm am:score --run ${runPath}`);
    scorePaths.push(resolve(runPath, 'score.json'));
  }

  const reportPath = resolve(AM_REPORTS, `${split}-iteration-${date}.md`);
  run(`pnpm am:report --scores ${scorePaths.join(' ')} --out ${reportPath}`);
  console.log(`\n✅ Itération ${split} — rapport: ${reportPath}`);
}

main();
