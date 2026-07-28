#!/usr/bin/env tsx
/**
 * Applique la signature Marcel sur les cas validés en visio.
 *
 * Usage:
 *   pnpm am:stamp-marcel --date 2026-07-29 --cases ham-0001,ham-0002
 *   pnpm am:stamp-marcel --date 2026-07-29 --all
 *
 * Ne jamais exécuter sans relecture Marcel réelle (O8/O9).
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const AM_ROOT = resolve(import.meta.dirname, '..');
const DEV_DIR = resolve(AM_ROOT, 'cases/dev');
const GATE_DIR = resolve(AM_ROOT, 'cases/gate');

type AmCase = {
  id: string;
  provenance: { source: string; reformule: boolean; valide_par: string | null };
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function collectCaseFiles(): string[] {
  const files: string[] = [];
  for (const dir of [DEV_DIR, GATE_DIR]) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) {
      const p = resolve(dir, entry);
      if (statSync(p).isFile() && entry.endsWith('.json')) files.push(p);
    }
  }
  return files.sort();
}

function main() {
  const date = arg('date');
  const casesArg = arg('cases');
  const all = process.argv.includes('--all');

  if (!date || (!casesArg && !all)) {
    console.error('Usage: pnpm am:stamp-marcel --date YYYY-MM-DD --cases ham-0001,... | --all');
    process.exit(1);
  }

  const stamp = `marcel:${date}`;
  const targetIds = all ? null : new Set(casesArg!.split(',').map((s) => s.trim()));

  const files = collectCaseFiles();
  let updated = 0;

  for (const file of files) {
    const c = JSON.parse(readFileSync(file, 'utf8')) as AmCase;
    if (targetIds && !targetIds.has(c.id)) continue;

    c.provenance.valide_par = stamp;
    writeFileSync(file, JSON.stringify(c, null, 2) + '\n');
    console.log(`✅ ${c.id} → ${stamp}`);
    updated++;
  }

  console.log(`\n${updated} cas signés.`);
  if (updated === 0) process.exit(1);
}

main();
