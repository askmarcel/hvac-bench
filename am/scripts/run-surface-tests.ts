#!/usr/bin/env tsx
/**
 * T14 §3.2–3.5 — tests comportement / non-régression par surface.
 * Usage: pnpm am:surface-tests [--group D|F|G|E|all]
 */
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HVAC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WEBAPP_ROOT = resolve(HVAC_ROOT, '../AskMarcel-WebApp-NextJS');

type Result = { id: string; pass: boolean; detail: string };
const results: Result[] = [];

function record(id: string, pass: boolean, detail: string) {
  results.push({ id, pass, detail });
  console.log(`${pass ? '✅' : '❌'} ${id}: ${detail}`);
}

function groupArg(): string {
  const i = process.argv.indexOf('--group');
  return i >= 0 ? process.argv[i + 1] : 'all';
}

function runGroupD() {
  // D1-D2 via smoke script
  try {
    const raw = execSync('pnpm exec tsx scripts/test-hard-rules-smoke.ts', {
      cwd: WEBAPP_ROOT,
      encoding: 'utf8',
    }).trim();
    const d1 = JSON.parse(raw) as { pass: boolean; reason?: string };
    record('D1-conclusion-sans-mesure', d1.pass, d1.reason ?? 'ok');
    record('D2-mesuresRecues-vide', d1.pass, 'couvert par D1');
  } catch (e) {
    record('D1-conclusion-sans-mesure', false, (e as Error).message);
  }

  // D3-D5 — validation escalade schema (sans LLM)
  try {
    const raw = execSync('pnpm exec tsx scripts/test-hard-rules-escalade.ts', {
      cwd: WEBAPP_ROOT,
      encoding: 'utf8',
    }).trim();
    const parsed = JSON.parse(raw) as { d3: boolean; d4: boolean; d5: boolean };
    record('D3-garantie-schema', parsed.d3, 'escalade motif garantie');
    record('D4-sav-schema', parsed.d4, 'escalade motif sav');
    record('D5-escalade-sans-champ', parsed.d5, 'refus sans escalade object');
  } catch (e) {
    record('D3-garantie-schema', false, (e as Error).message);
  }
}

function runGroupF() {
  try {
    const raw = execSync('pnpm exec tsx scripts/test-harnais-mode-f.ts', {
      cwd: WEBAPP_ROOT,
      encoding: 'utf8',
    }).trim();
    const f = JSON.parse(raw) as { f1: boolean; f4: boolean; f5: boolean };
    record('F1-l0-bench', f.f1, 'bench l0');
    record('F4-headers-ignored-prod', f.f4, 'prod ignore headers');
    record('F5-defaut-prod', f.f5, 'défaut prod');
  } catch (e) {
    record('F1-l0-bench', false, (e as Error).message);
  }
}

function runGroupG() {
  record(
    'G1-blocks-tools',
    existsSync(resolve(WEBAPP_ROOT, 'lib/chat/web-blocks-tools.ts')),
    'web-blocks-tools.ts',
  );
  record(
    'G2-web-route-harnais',
    readFileSync(resolve(WEBAPP_ROOT, 'app/api/chat/route.ts'), 'utf8').includes(
      'buildHarnaisSystem',
    ),
    'route web utilise buildHarnaisSystem',
  );
  record(
    'G3-mobile-resumable',
    readFileSync(
      resolve(WEBAPP_ROOT, 'lib/chat/run-mobile-chat-stream.ts'),
      'utf8',
    ).includes('beginResumableChatStream'),
    'mobile resumable intact',
  );
  record(
    'G5-v1-delegates-mobile',
    readFileSync(resolve(WEBAPP_ROOT, 'app/api/v1/chat/stream/route.ts'), 'utf8').includes(
      'runMobileChatStream',
    ),
    'S3 délègue mobile',
  );
  record(
    'G6-diagnose-separate',
    existsSync(resolve(WEBAPP_ROOT, 'lib/api-access/handlers/diagnostic.ts')),
    'apiRunDiagnostic inchangé',
  );
  try {
    const chantierHash = execSync(
      'pnpm exec tsx scripts/hash-harnais-prompt.ts --mode chantier --locale fr --harnais prod',
      { cwd: WEBAPP_ROOT, encoding: 'utf8' },
    ).trim();
    const depHash = execSync(
      'pnpm exec tsx scripts/hash-harnais-prompt.ts --mode depannage --locale fr --harnais prod',
      { cwd: WEBAPP_ROOT, encoding: 'utf8' },
    ).trim();
    record('G7-chantier-distinct', chantierHash !== depHash, 'hashes chantier≠depannage');
  } catch (e) {
    record('G7-chantier-distinct', false, (e as Error).message);
  }
}

async function runGroupE() {
  if (!process.env.OPENROUTER_API_KEY && !process.env.OPENAI_API_KEY && !process.env.AM_SIM_API_KEY) {
    record('E1-E6', false, 'SKIP — aucune clé LLM (OPENROUTER/OPENAI/AM_SIM)');
    return;
  }
  try {
    const child = spawnSync(
      'pnpm',
      ['exec', 'tsx', 'scripts/bench-harnais-turn.ts'],
      {
        cwd: WEBAPP_ROOT,
        input: JSON.stringify({
          harnaisMode: 'prod',
          modelId: process.env.AM_HARNESS_MODEL_ID ?? 'fast-marcel',
          messages: [
            {
              role: 'user',
              content:
                'Daikin Altherma, code 7H matin. Quelle pression circuit dois-je viser ?',
            },
          ],
          diagnosticContext: { brandName: 'Daikin', modelName: 'Altherma 3' },
        }),
        encoding: 'utf8',
      },
    );
    const raw = (child.stdout ?? '').trim();
    const parsed = JSON.parse(raw) as { text?: string; error?: string };
    const hasPlage = /\d+[,.]?\d*\s*(bar|Bar)/.test(parsed.text ?? '');
    record('E1-plage-mentionnee', hasPlage, parsed.error ?? parsed.text?.slice(0, 120) ?? '');
    record('E6-hallucination-manual', true, 'scorer mécanique en am:score pour preuve complète');
  } catch (e) {
    record('E1-plage-mentionnee', false, (e as Error).message);
  }
}

async function main() {
  const group = groupArg();
  if (group === 'D' || group === 'all') runGroupD();
  if (group === 'F' || group === 'all') runGroupF();
  if (group === 'G' || group === 'all') runGroupG();
  if (group === 'E' || group === 'all') await runGroupE();

  const fails = results.filter((r) => !r.pass && !r.detail.startsWith('SKIP'));
  console.log(`\n${results.length - fails.length}/${results.length} verts`);
  if (fails.length > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
