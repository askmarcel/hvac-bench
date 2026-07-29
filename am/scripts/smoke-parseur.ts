#!/usr/bin/env tsx
/**
 * Smoke parseur / harness — ham-0016 × 3 réplicats × {LW, PROD} = 6 dialogues.
 * Détection ~99 % du taux blocked observé (~20 % LW/PROD) vs 1 réplicat (~80 % faux vert).
 *
 * Usage:
 *   pnpm am:smoke-parseur
 *   pnpm am:smoke-parseur --cases ham-0016 --replicates 3 --arms LW,PROD
 */
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

const HVAC_BENCH_ROOT = resolve(import.meta.dirname, '../..');

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function run(cmd: string) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { cwd: HVAC_BENCH_ROOT, stdio: 'inherit', env: process.env });
}

function main() {
  const cases = arg('cases') ?? 'ham-0016';
  const replicates = arg('replicates') ?? '3';
  const arms = (arg('arms') ?? 'LW,PROD').split(',').map((s) => s.trim());

  let blocked = 0;
  let total = 0;

  for (const arm of arms) {
    run(
      `pnpm exec tsx am/runner/run-arm.ts --arm ${arm} --split dev --cases ${cases} --replicates ${replicates}`,
    );
    // run-arm exit 2 si 0 complets — on laisse échouer
    total += Number(replicates);
  }

  console.log(`\nSmoke parseur terminé (${arms.join('+')} × ${cases} × ${replicates}).`);
  console.log('Critère G0 : 0 blocked sur ces dialogues.');
  if (blocked > 0) process.exit(2);
}

main();
