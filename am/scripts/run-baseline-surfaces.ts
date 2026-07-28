#!/usr/bin/env tsx
/**
 * Baseline §2 — fige l'écart surfaces (grep + prompt hash + règles dures).
 * Usage: pnpm am:baseline-surfaces --write-report
 */
import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HVAC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WEBAPP_ROOT = resolve(HVAC_ROOT, '../AskMarcel-WebApp-NextJS');
const REPORT_PATH = resolve(HVAC_ROOT, 'reports/baseline-surfaces-2026-07-28.md');

type Row = { id: string; pass: boolean; detail: string };

const rows: Row[] = [];

function row(id: string, pass: boolean, detail: string) {
  rows.push({ id, pass, detail });
  console.log(`${pass ? '✅' : '❌'} ${id}: ${detail}`);
}

function grepWebapp(pattern: string): string {
  try {
    return execSync(`grep -rn "${pattern}" app/api/ || true`, {
      cwd: WEBAPP_ROOT,
      encoding: 'utf8',
    }).trim();
  } catch {
    return '';
  }
}

// B1
const streamApi = grepWebapp('streamText');
row(
  'B1-streamText-api',
  streamApi.length === 0,
  streamApi.length === 0 ? '0 streamText dans app/api/' : `trouvé: ${streamApi.split('\n')[0]}`,
);

const presentInline = grepWebapp('presentDiagnostic: tool\\(');
row(
  'B1-presentInline-api',
  presentInline.length === 0,
  presentInline.length === 0
    ? '0 presentDiagnostic inline dans app/api/'
    : `inline: ${presentInline.split('\n')[0]}`,
);

// B4 — règle dure (subprocess WebApp)
try {
  const b4Raw = execSync('pnpm exec tsx scripts/test-hard-rules-smoke.ts', {
    cwd: WEBAPP_ROOT,
    encoding: 'utf8',
  }).trim();
  const b4 = JSON.parse(b4Raw) as { pass: boolean; reason?: string };
  row(
    'B4-hard-rule-refuse',
    b4.pass,
    b4.pass ? `refus OK: ${b4.reason?.slice(0, 80)}` : 'accepté sans mesure',
  );
} catch (e) {
  row('B4-hard-rule-refuse', false, (e as Error).message);
}

// B5
try {
  const hash = execSync(
    'pnpm exec tsx scripts/hash-harnais-prompt.ts --mode depannage --locale fr --harnais prod',
    { cwd: WEBAPP_ROOT, encoding: 'utf8' },
  ).trim();
  row('B5-prompt-hash', hash.length === 64, `SHA256=${hash.slice(0, 24)}…`);
} catch (e) {
  row('B5-prompt-hash', false, (e as Error).message);
}

// B2 — live LLM
row(
  'B2-live-plage',
  false,
  'SKIP — voir am:surface-tests --group E (clés LLM requises)',
);

const report = [
  '# Baseline surfaces — 2026-07-28',
  '',
  '| ID | Résultat | Détail |',
  '|---|---|---|',
  ...rows.map((r) => `| ${r.id} | ${r.pass ? 'VERT' : 'ROUGE/SKIP'} | ${r.detail.replace(/\|/g, '\\|')} |`),
  '',
  '## Écart pré-T13 (archivé)',
  '',
  '- S1 : streamText inline, presentDiagnostic pass-through, 0 tool DATA',
  '- S2 : runMobileChatStream T8-complet',
  '- Bug : prompt ordonnait get_plages sans tools sur S1',
  '',
].join('\n');

if (process.argv.includes('--write-report')) {
  mkdirSync(resolve(HVAC_ROOT, 'reports'), { recursive: true });
  writeFileSync(REPORT_PATH, report);
  console.log(`Rapport: ${REPORT_PATH}`);
}

const hardFails = rows.filter((r) => !r.pass && !r.id.includes('B2') && !r.id.includes('SKIP'));
if (hardFails.length > 0) process.exit(1);
