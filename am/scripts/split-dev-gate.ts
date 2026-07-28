#!/usr/bin/env tsx
/**
 * Tirage aléatoire 10 dev / 10 gate (T3 + T9) — seed documentée dans preregistration-am.md.
 *
 * Usage:
 *   pnpm am:split-dev-gate --seed 20260728 --dry-run
 *   pnpm am:split-dev-gate --seed 20260728 --apply
 *
 * Prérequis : tous les cas doivent avoir provenance.valide_par (visio Marcel).
 */
import { createHash } from 'node:crypto';
import {
  readFileSync,
  writeFileSync,
  readdirSync,
  existsSync,
  mkdirSync,
  unlinkSync,
} from 'node:fs';
import { resolve } from 'node:path';

const AM_ROOT = resolve(import.meta.dirname, '..');
const DEV_DIR = resolve(AM_ROOT, 'cases/dev');
const GATE_DIR = resolve(AM_ROOT, 'cases/gate');

type AmCase = {
  id: string;
  provenance: { valide_par: string | null };
  split: 'dev' | 'gate';
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function seededShuffle<T>(items: T[], seed: string): T[] {
  const arr = [...items];
  let state = createHash('sha256').update(seed).digest();
  for (let i = arr.length - 1; i > 0; i--) {
    const byte = state[i % state.length]! ^ state[(i + 7) % state.length]!;
    const j = byte % (i + 1);
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
    state = createHash('sha256').update(state).update(String(i)).digest();
  }
  return arr;
}

function loadAllCases(): { path: string; case: AmCase }[] {
  const out: { path: string; case: AmCase }[] = [];
  for (const dir of [DEV_DIR, GATE_DIR]) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith('.json')) continue;
      const path = resolve(dir, entry);
      out.push({ path, case: JSON.parse(readFileSync(path, 'utf8')) as AmCase });
    }
  }
  return out.sort((a, b) => a.case.id.localeCompare(b.case.id));
}

function main() {
  const seed = arg('seed');
  const apply = process.argv.includes('--apply');

  if (!seed) {
    console.error('Usage: pnpm am:split-dev-gate --seed <seed> [--dry-run | --apply]');
    process.exit(1);
  }

  const all = loadAllCases();
  if (all.length !== 20) {
    console.error(`Attendu 20 cas, trouvé ${all.length}.`);
    process.exit(1);
  }

  const unsigned = all.filter((c) => !c.case.provenance.valide_par);
  if (unsigned.length > 0) {
    console.error(
      `🚫 ${unsigned.length} cas sans valide_par — visio Marcel requise avant le split :\n` +
        unsigned.map((c) => `  - ${c.case.id}`).join('\n'),
    );
    process.exit(1);
  }

  const ids = all.map((c) => c.case.id);
  const shuffled = seededShuffle(ids, seed);
  const gateIds = new Set(shuffled.slice(0, 10));
  const devIds = new Set(shuffled.slice(10));

  console.log(`Seed: ${seed}`);
  console.log(`GATE (${gateIds.size}): ${[...gateIds].sort().join(', ')}`);
  console.log(`DEV  (${devIds.size}): ${[...devIds].sort().join(', ')}`);

  if (!apply) {
    console.log('\nMode dry-run — aucun fichier modifié. Relancer avec --apply pour appliquer.');
    return;
  }

  mkdirSync(GATE_DIR, { recursive: true });
  mkdirSync(DEV_DIR, { recursive: true });

  for (const { path, case: c } of all) {
    const targetSplit = gateIds.has(c.id) ? 'gate' : 'dev';
    c.split = targetSplit;
    const targetDir = targetSplit === 'gate' ? GATE_DIR : DEV_DIR;
    const targetPath = resolve(targetDir, `${c.id}.json`);
    writeFileSync(targetPath, JSON.stringify(c, null, 2) + '\n');
    if (path !== targetPath) {
      unlinkSync(path);
    }
    console.log(`✅ ${c.id} → ${targetSplit}/`);
  }

  console.log('\nSplit appliqué. Mettre à jour am/preregistration-am.md avec les rosters ci-dessus.');
}

main();
