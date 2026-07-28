/**
 * Harness interactif v2 — bras B/E via OpenRouter (CDC §6, Phase 7)
 *
 * Usage:
 *   OPENROUTER_API_KEY=… pnpm run:v2:arm-b
 *   OPENROUTER_API_KEY=… pnpm run:v2:arm-e
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { scoreV2RunDual } from '../scorer/v2/index.js';
import { extractJson, newRunId } from './lib.js';
import { buildRunManifestBase } from './manifest-v2.js';
import { loadPreregistrationHash } from './preregistration.js';
import { resolveV2ArmModel } from './models-v2.js';
import {
  buildRunRecord,
  loadActionRegistry,
  loadV2Cases,
  lookupObservation,
  T_MAX,
  type PilotCaseExtended,
} from './v2-harness.js';

const PROMPT_PATH = resolve(import.meta.dirname, '../prompts/v2-shared-v1.md');
const TIMEOUT_MS = Number(process.env.BENCH_TIMEOUT_MS ?? 120_000);

type LlmTurn = {
  state: string;
  next_action?: string;
  cause_id?: string;
  steps?: unknown[];
  escalation?: unknown;
  rationale?: string;
};

function buildSystemPrompt(arm: 'B' | 'E', actions: Array<{ action_id: string; label: string }>): string {
  const base = readFileSync(PROMPT_PATH, 'utf8');
  const registry = actions.map((a) => `- ${a.action_id}: ${a.label}`).join('\n');
  const armNote =
    arm === 'B'
      ? '\n\n## Mode bras B\nRecherche web autorisée pour compléter le diagnostic.'
      : '\n\n## Mode bras E\nUn extrait manuel constructeur est fourni dans le message utilisateur.';
  return `${base}\n\n## Registre complet\n${registry}${armNote}`;
}

function buildUserMessage(c: PilotCaseExtended, history: string, arm: 'B' | 'E'): string {
  const parts = [
    `Symptôme : ${c.symptom.narrative}`,
    `Marque : ${c.context.brand ?? 'inconnue'}`,
    `Type équipement : ${c.context.equipment_type}`,
    c.symptom.code_present ? `Code : ${c.symptom.code_present}` : 'Pas de code erreur',
    `in_corpus : ${c.context.in_corpus}`,
  ];
  if (arm === 'E' && c.manual_context?.excerpt) {
    parts.push(
      `\n--- MANUEL CONSTRUCTEUR (${c.manual_context.title}, p.${c.manual_context.page}) ---\n${c.manual_context.excerpt}`,
    );
  }
  if (history) parts.push(`\nHistorique des tours :\n${history}`);
  parts.push('\nRéponds en JSON strict (un seul objet).');
  return parts.join('\n');
}

async function callLlm(
  model: string,
  temperature: number,
  apiKey: string,
  system: string,
  user: string,
  webSearch: boolean,
): Promise<{ parsed: LlmTurn | null; raw: string; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const body: Record<string, unknown> = {
    model,
    temperature,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    response_format: { type: 'json_object' },
  };

  if (webSearch) {
    body.plugins = [{ id: 'web', max_results: 5 }];
  }

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://github.com/askmarcel/hvac-bench',
        'X-Title': `hvac-bench-v2-arm-${webSearch ? 'b' : 'e'}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await res.text();
    if (!res.ok) {
      return { parsed: null, raw: text, error: `HTTP ${res.status}` };
    }

    const payload = JSON.parse(text) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content ?? '';
    const parsed = extractJson(content) as LlmTurn | null;
    return { parsed, raw: content };
  } catch (e) {
    return { parsed: null, raw: '', error: e instanceof Error ? e.message : 'unknown' };
  } finally {
    clearTimeout(timer);
  }
}

async function runCase(
  arm: 'B' | 'E',
  model: string,
  temperature: number,
  webSearch: boolean,
  apiKey: string,
  system: string,
  actionIds: Set<string>,
  c: PilotCaseExtended,
  replicate: number,
): Promise<ReturnType<typeof buildRunRecord>> {
  const path: string[] = [];
  let history = '';
  let turns = 0;
  let final_output: Record<string, unknown> = {};
  let concluded = false;
  let cause_id: string | null = null;
  let format_fail = false;

  while (turns < T_MAX) {
    const { parsed, error } = await callLlm(
      model,
      temperature,
      apiKey,
      system,
      buildUserMessage(c, history, arm),
      webSearch,
    );

    if (!parsed) {
      format_fail = true;
      final_output = { state: 'format_fail', error, raw: error };
      break;
    }

    final_output = parsed as Record<string, unknown>;
    const state = parsed.state;

    if (state === 'conclusion') {
      concluded = true;
      cause_id = parsed.cause_id ?? null;
      turns++;
      break;
    }

    if (state === 'escalation' || state === 'clarification') {
      turns++;
      break;
    }

    const nextAction = parsed.next_action;
    if (!nextAction || !actionIds.has(nextAction)) {
      format_fail = true;
      final_output = { state: 'unknown_action', next_action: nextAction };
      turns++;
      break;
    }

    path.push(nextAction);
    const { observation } = lookupObservation(c, nextAction);
    history += `Tour ${turns + 1}: action=${nextAction} → observation="${observation}"\n`;
    turns++;

    if (parsed.state === 'conclusion') break;
  }

  if (!concluded && !final_output.state) {
    final_output = { state: 'non_convergent', path };
  }

  return buildRunRecord({
    c,
    arm,
    replicate,
    path,
    concluded,
    cause_id,
    turns,
    final_output,
    format_fail,
  });
}

async function main() {
  const armArg = process.argv.find((a) => a === '--arm' || a.startsWith('--arm='));
  let arm: 'B' | 'E' = 'B';
  const idx = process.argv.indexOf('--arm');
  if (idx >= 0 && process.argv[idx + 1]) {
    arm = process.argv[idx + 1]!.toUpperCase() as 'B' | 'E';
  }

  const apiKey = process.env.OPENROUTER_API_KEY ?? process.env.BENCH_ARM_B_API_KEY;
  if (!apiKey) {
    console.error('Définir OPENROUTER_API_KEY');
    process.exit(1);
  }

  const { model, temperature, webSearch } = resolveV2ArmModel(arm);
  const actions = loadActionRegistry();
  const actionIds = new Set(actions.map((a) => a.action_id));
  const system = buildSystemPrompt(arm, actions);
  const cases = loadV2Cases() as PilotCaseExtended[];
  const replicates = Number(process.env.BENCH_REPLICATES ?? 3);
  const runId = newRunId(`pilot-v2-${arm.toLowerCase()}`);
  const outDir = resolve(import.meta.dirname, `../runs/${runId}`);
  mkdirSync(outDir, { recursive: true });

  const records = [];
  for (const c of cases) {
    for (let rep = 0; rep < replicates; rep++) {
      const rec = await runCase(arm, model, temperature, webSearch, apiKey, system, actionIds, c, rep);
      records.push(rec);
      console.log(`${c.id} rep${rep}: ${rec.path.join('→') || '—'} → ${rec.final_output.state}`);
    }
  }

  writeFileSync(resolve(outDir, 'raw.jsonl'), records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const scores = scoreV2RunDual(cases, records);
  writeFileSync(resolve(outDir, `score-${arm.toLowerCase()}.json`), JSON.stringify(scores.current, null, 2));
  writeFileSync(
    resolve(outDir, `score-${arm.toLowerCase()}-legacy.json`),
    JSON.stringify(scores.legacy, null, 2),
  );
  writeFileSync(
    resolve(outDir, 'manifest.json'),
    JSON.stringify(
      {
        ...buildRunManifestBase(arm, runId, replicates, cases.length),
        model_id: model,
        temperature,
        web_search: webSearch,
        scorer_version: scores.current.scorer_version,
        scorer_legacy_version: scores.legacy.scorer_version,
        preregistration_hash: loadPreregistrationHash(),
      },
      null,
      2,
    ) + '\n',
  );

  console.log(`Arm ${arm} (${model}):`, scores.current);
  console.log(`Wrote ${records.length} records to ${outDir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
