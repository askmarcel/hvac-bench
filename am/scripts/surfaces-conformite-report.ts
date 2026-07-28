#!/usr/bin/env tsx
/**
 * H1-H4 — rapport conformité inter-surfaces + comparaison scores.
 * Usage: pnpm am:surfaces-report [--runs-dir runs/]
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HVAC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const date = new Date().toISOString().slice(0, 10);
const REPORT = resolve(HVAC_ROOT, 'reports', `surfaces-conformite-${date}.md`);

function findRunDirs(): string[] {
  const runsDir = resolve(HVAC_ROOT, 'runs');
  if (!exists(runsDir)) return [];
  return readdirSync(runsDir)
    .map((name) => resolve(runsDir, name))
    .filter((p) => statSync(p).isDirectory())
    .sort();
}

function exists(p: string): boolean {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

function loadCauseOk(runDir: string): number | null {
  const scorePath = resolve(runDir, 'score.json');
  if (!exists(scorePath)) return null;
  try {
    const score = JSON.parse(readFileSync(scorePath, 'utf8')) as {
      aggregates?: { cause_ok?: number };
    };
    return score.aggregates?.cause_ok ?? null;
  } catch {
    return null;
  }
}

const runDirs = findRunDirs();
const surfaceRuns = runDirs.filter((d) => {
  const m = resolve(d, 'manifest.json');
  return exists(m);
});

const lines = [
  `# Surfaces conformité — ${date}`,
  '',
  'Référence: PLAN-TEST-Surfaces-Chat-AskMarcel.md §4 H4',
  '',
  '| Run | Surface | cause_ok |',
  '|---|---|---|',
];

const bySurface: Record<string, number[]> = {};

for (const dir of surfaceRuns.slice(-12)) {
  const manifest = JSON.parse(readFileSync(resolve(dir, 'manifest.json'), 'utf8')) as {
    run_id: string;
    surface?: string;
  };
  const surface = manifest.surface ?? 'S2';
  const causeOk = loadCauseOk(dir);
  lines.push(`| ${manifest.run_id} | ${surface} | ${causeOk ?? 'n/a'} |`);
  if (causeOk != null) {
    bySurface[surface] = bySurface[surface] ?? [];
    bySurface[surface].push(causeOk);
  }
}

lines.push('', '## H4 — écart inter-surfaces', '');
const surfaces = Object.keys(bySurface);
if (surfaces.length >= 2) {
  const medians = surfaces.map((s) => {
    const arr = bySurface[s];
    const mid = arr[Math.floor(arr.length / 2)];
    return { s, mid };
  });
  const h4Pass = medians.every((m) => m.mid === medians[0].mid);
  lines.push(
    h4Pass ? '✅ H4 VERT — cause_ok identique' : '❌ H4 ROUGE — écart détecté',
    '',
    medians.map((m) => `- ${m.s}: ${m.mid}`).join('\n'),
  );
} else {
  lines.push('⚠️ H4 — exécuter am:run-arm --surface S1/S2/S3 puis am:score');
}

mkdirSync(resolve(HVAC_ROOT, 'reports'), { recursive: true });
writeFileSync(REPORT, lines.join('\n'));
console.log(`Rapport: ${REPORT}`);
