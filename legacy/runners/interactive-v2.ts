/**
 * Harness interactif v2 — SMOKE TEST SCORER UNIQUEMENT (CDC §6)
 *
 * ⚠️ NE PAS UTILISER POUR LE VERDICT PHASE 7.
 * Bras D/B/E sont des oracles locaux qui suivent ou déforment `expert_path` —
 * aucun modèle, aucun appel API. Les métriques produites sont tautologiques.
 *
 * Verdict réel : POST /api/v2/diagnose/session + /turn (bras D) et OpenRouter (bras B/E).
 *
 * Usage: pnpm run:v2:pilot [--arm d|b|e]   # smoke scorer seulement
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { scoreV2Run, type V2Case, type V2RunRecord } from '../scorer/v2/index.js';

const T_MAX = 5;

function loadCases(): V2Case[] {
  const path = resolve(import.meta.dirname, '../dataset/pilot/pilot-v2.jsonl');
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as V2Case);
}

function trueCauseId(c: V2Case): string {
  return c.hypotheses.find((h) => h.true_cause)!.id;
}

/** Stratégie bras D : suit expert_path (oracle bench) */
function runExpertOracle(c: V2Case, arm: string, replicate: number): V2RunRecord {
  const path: string[] = [];
  let concluded = false;
  let cause_id: string | null = null;
  let turns = 0;
  let final_output: Record<string, unknown> = {};

  for (const aid of c.expert_path) {
    if (turns >= T_MAX) break;
    path.push(aid);
    turns++;
    const test = c.tests.find((t) => t.action_id === aid);
    if (test?.resolves) {
      concluded = true;
      cause_id = trueCauseId(c);
      final_output = {
        state: 'conclusion',
        cause_id,
        steps: [{ order: 1, text: test.observation ?? 'Résolu' }],
      };
      break;
    }
  }

  if (!concluded) {
    final_output = { state: 'non_convergent', path };
  }

  return {
    case_id: c.id,
    replicate,
    arm,
    path,
    concluded,
    cause_id,
    true_cause_id: trueCauseId(c),
    turns,
    final_output,
  };
}

/** Bras B : suit expert_path mais saute la 1ère mesure (moins efficace) */
function runArmB(c: V2Case, replicate: number): V2RunRecord {
  const degraded = [...c.expert_path.slice(1), 'REM-CIRCULATEUR'].filter(
    (a, i, arr) => arr.indexOf(a) === i,
  );
  const fake = { ...c, expert_path: degraded };
  const r = runExpertOracle(fake, 'B', replicate);
  const wrong = c.tests.find((t) => t.wrong_part);
  if (wrong && !r.path.includes(wrong.action_id)) {
    r.path.push(wrong.action_id);
    r.turns++;
  }
  return r;
}

/** Bras E : conclut trop tôt (premature closure) */
function runArmE(c: V2Case, replicate: number): V2RunRecord {
  const r = runExpertOracle(c, 'E', replicate);
  if (c.expert_path.length > 1) {
    r.path = [c.expert_path[0]!];
    r.turns = 1;
    r.concluded = true;
    r.cause_id = c.hypotheses.find((h) => !h.true_cause)?.id ?? null;
    r.final_output = { state: 'conclusion', cause_id: r.cause_id, steps: [{ order: 1, text: c.hypotheses[1]?.id }] };
  }
  return r;
}

function main() {
  const args = process.argv.slice(2);
  const armIdx = args.indexOf('--arm');
  const arm = armIdx >= 0 ? args[armIdx + 1] ?? 'd' : 'all';
  const cases = loadCases();
  const records: V2RunRecord[] = [];

  const arms = arm === 'all' ? ['D', 'B', 'E'] : [arm.toUpperCase()];

  for (const a of arms) {
    for (const c of cases) {
      for (let rep = 0; rep < 3; rep++) {
        if (a === 'D') records.push(runExpertOracle(c, 'D', rep));
        else if (a === 'B') records.push(runArmB(c, rep));
        else if (a === 'E') records.push(runArmE(c, rep));
      }
    }
  }

  const outDir = resolve(import.meta.dirname, '../runs/pilot-v2-2026-07-26');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    resolve(outDir, 'manifest.json'),
    JSON.stringify(
      {
        mode: 'oracle_smoke',
        warning:
          'Smoke test scorer — D/B/E oracles locaux. Métriques invalides pour Phase 7.',
        created_at: new Date().toISOString(),
      },
      null,
      2,
    ) + '\n',
  );
  const rawPath = resolve(outDir, 'raw.jsonl');
  writeFileSync(rawPath, records.map((r) => JSON.stringify(r)).join('\n') + '\n');

  for (const a of arms) {
    const subset = records.filter((r) => r.arm === a);
    const metrics = scoreV2Run(cases, subset);
    writeFileSync(resolve(outDir, `score-${a.toLowerCase()}.json`), JSON.stringify(metrics, null, 2));
    console.log(`Arm ${a}:`, metrics);
  }

  console.log(`Wrote ${records.length} records to ${rawPath}`);
}

main();
