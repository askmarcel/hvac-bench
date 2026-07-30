#!/usr/bin/env tsx
/**
 * Smoke harnais — ham-0016 × 3 réplicats × {LW, PROD} = 6 dialogues.
 * Appelle runHarnaisTurn in-process (CORE) — pas l'API mobile ni le parseur SSE.
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

function run(cmd: string): { ok: boolean; error?: string } {
  console.log(`\n$ ${cmd}`);
  try {
    execSync(cmd, { cwd: HVAC_BENCH_ROOT, stdio: 'inherit', env: process.env });
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: message };
  }
}

function main() {
  const cases = arg('cases') ?? 'ham-0016';
  const replicates = arg('replicates') ?? '3';
  const arms = (arg('arms') ?? 'LW,PROD').split(',').map((s) => s.trim());

  const results: Array<{ arm: string; ok: boolean; error?: string }> = [];

  for (const arm of arms) {
    const result = run(
      `pnpm exec tsx am/runner/run-arm.ts --arm ${arm} --split dev --surface CORE --cases ${cases} --replicates ${replicates}`,
    );
    results.push({ arm, ...result });
  }

  console.log('\n--- Résumé smoke ---');
  for (const r of results) {
    console.log(`${r.ok ? '✅' : '❌'} ${r.arm}${r.error ? ` — ${r.error}` : ''}`);
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.error(`\n🚫 Smoke échoué sur ${failed.length}/${results.length} bras.`);
    process.exit(1);
  }

  console.log(`\nSmoke harnais terminé (${arms.join('+')} × ${cases} × ${replicates}).`);
  console.log('Critère G0 : 0 blocked (vérifié par run-arm).');
}

main();
