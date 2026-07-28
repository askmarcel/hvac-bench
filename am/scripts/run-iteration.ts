#!/usr/bin/env tsx
/**
 * T11 — run complet split dev (10 cas × 3 bras × 3 réplicats) + scores + rapport.
 * T12 — idem avec --split gate (via am:run-gate).
 *
 * Usage:
 *   pnpm am:run-iteration --split dev
 *   pnpm am:run-iteration --split dev --arms LW,PROD
 *   pnpm am:run-iteration --split dev --arms LW,PROD --include-scores runs/am-l0-*/score.json
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { refreshHarnessBearerToken } from '../runner/bench-auth.js';

const HVAC_BENCH_ROOT = resolve(import.meta.dirname, '../..');
const AM_REPORTS = resolve(HVAC_BENCH_ROOT, 'am/reports');

const ALL_ARMS = ['L0', 'LW', 'PROD'] as const;
type Arm = (typeof ALL_ARMS)[number];

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

function parseArms(): Arm[] {
  const raw = arg('arms');
  if (!raw) return [...ALL_ARMS];
  const arms = raw.split(',').map((s) => s.trim().toUpperCase()) as Arm[];
  for (const a of arms) {
    if (!ALL_ARMS.includes(a)) {
      console.error(`--arms invalide : ${a} (attendu L0|LW|PROD)`);
      process.exit(1);
    }
  }
  return arms;
}

function collectIncludeScores(): string[] {
  const idx = process.argv.indexOf('--include-scores');
  if (idx < 0) return [];
  const paths: string[] = [];
  for (let i = idx + 1; i < process.argv.length; i++) {
    const a = process.argv[i]!;
    if (a.startsWith('--')) break;
    paths.push(resolve(HVAC_BENCH_ROOT, a));
  }
  return paths.filter((p) => {
    if (!existsSync(p)) {
      console.error(`🚫 score introuvable : ${p}`);
      process.exit(1);
    }
    return true;
  });
}

async function main() {
  const split = arg('split') ?? 'dev';
  if (split !== 'dev' && split !== 'gate') {
    console.error('--split doit être dev ou gate');
    process.exit(1);
  }

  const arms = parseArms();
  const includeScores = collectIncludeScores();

  try {
    await refreshHarnessBearerToken();
    console.log(`✅ JWT bench initialisé (${process.env.AM_HARNESS_BENCH_EMAIL ?? 'th1b4ut.dev@gmail.com'})`);
  } catch (e) {
    if (!process.env.AM_HARNESS_BEARER_TOKEN) {
      console.error(`🚫 ${(e as Error).message}`);
      process.exit(2);
    }
    console.warn(`⚠️  Refresh JWT initial échoué — fallback AM_HARNESS_BEARER_TOKEN : ${(e as Error).message}`);
  }

  const date = new Date().toISOString().slice(0, 10);
  mkdirSync(AM_REPORTS, { recursive: true });
  const scorePaths: string[] = [...includeScores];

  for (const arm of arms) {
    try {
      await refreshHarnessBearerToken();
      console.log(`\n🔑 JWT bench rafraîchi avant bras ${arm}`);
    } catch (e) {
      console.error(`🚫 Refresh JWT avant ${arm} échoué : ${(e as Error).message}`);
      process.exit(2);
    }

    run(`pnpm exec tsx am/runner/run-arm.ts --arm ${arm} --split ${split} --replicates 3`);
    const runPath = latestRunDir();
    if (!existsSync(resolve(runPath, 'raw.jsonl'))) {
      console.error(`Run sans raw.jsonl — arrêt.`);
      process.exit(2);
    }
    run(`pnpm am:score --run ${runPath}`);
    scorePaths.push(resolve(runPath, 'score.json'));
  }

  if (scorePaths.length === 0) {
    console.error('Aucun score à rapporter.');
    process.exit(1);
  }

  const reportPath = resolve(AM_REPORTS, `${split}-iteration-${date}.md`);
  run(`pnpm am:report --scores ${scorePaths.join(' ')} --out ${reportPath}`);
  console.log(`\n✅ Itération ${split} — bras: ${arms.join(', ')} — rapport: ${reportPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
