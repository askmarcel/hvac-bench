/**
 * Bras D v2 — API /api/v2/diagnose/session + /turn (CDC §6, NFR-6′)
 *
 * Usage:
 *   BENCH_API_URL=http://localhost:3000 BENCH_API_KEY=… \
 *   pnpm run:v2:arm-d [--cases dataset/pilot/pilot-v2.jsonl] [--replicates 3]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { scoreV2RunDual } from '../scorer/v2/index.js';
import { arg, newRunId } from './lib.js';
import { buildRunManifestBase } from './manifest-v2.js';
import { loadPreregistrationHash } from './preregistration.js';
import {
  buildRunRecord,
  loadV2Cases,
  lookupObservation,
  T_MAX,
  type PilotCaseExtended,
} from './v2-harness.js';

const TIMEOUT_MS = Number(process.env.BENCH_TIMEOUT_MS ?? 60_000);
const INTER_CALL_MS = Number(process.env.BENCH_INTER_CALL_MS ?? 1_100);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function apiFetch(
  url: string,
  apiKey: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-AM-Key': apiKey,
        Authorization: `Bearer ${apiKey}`,
        ...(init.headers as Record<string, string>),
      },
    });
  } finally {
    clearTimeout(timer);
    if (INTER_CALL_MS > 0) await sleep(INTER_CALL_MS);
  }
}

async function runCase(
  baseUrl: string,
  apiKey: string,
  runId: string,
  c: PilotCaseExtended,
  replicate: number,
  armLabel: string,
): Promise<ReturnType<typeof buildRunRecord>> {
  const path: string[] = [];
  let turns = 0;
  let final_output: Record<string, unknown> = {};
  let concluded = false;
  let cause_id: string | null = null;

  const openRes = await apiFetch(`${baseUrl}/api/v2/diagnose/session`, apiKey, {
    method: 'POST',
    body: JSON.stringify({
      symptom: {
        narrative: c.symptom.narrative,
        code_present: c.symptom.code_present,
        code_absent_by_design: c.symptom.code_absent_by_design ?? false,
      },
      context: {
        brand: c.context.brand,
        model: c.context.model ?? null,
        equipment_type: c.context.equipment_type,
        in_corpus: c.context.in_corpus,
        season: c.context.season ?? null,
        emitter: c.context.emitter ?? null,
      },
      initial_readings: c.initial_readings ?? {},
      locale: c.locale ?? 'fr',
      actor: `bench:${runId}`,
    }),
  });

  if (!openRes.ok) {
    const errText = await openRes.text();
    return buildRunRecord({
      c,
      arm: armLabel,
      replicate,
      path,
      concluded: false,
      cause_id: null,
      turns: 0,
      final_output: { state: 'error', error: errText.slice(0, 200) },
      format_fail: true,
    });
  }

  const opened = (await openRes.json()) as {
    session_id: string;
    next_action: string | null;
    state: string;
    hypotheses_ranked?: Array<{ id: string; prior: number; label?: string }>;
  };

  const hypothesesInitial = opened.hypotheses_ranked;

  let nextAction = opened.next_action;
  let sessionId = opened.session_id;

  while (turns < T_MAX && nextAction) {
    const { observation } = lookupObservation(c, nextAction);
    path.push(nextAction);
    turns++;

    const turnRes = await apiFetch(
      `${baseUrl}/api/v2/diagnose/session/${sessionId}/turn`,
      apiKey,
      {
        method: 'POST',
        body: JSON.stringify({
          action_id: nextAction,
          observation,
        }),
      },
    );

    if (!turnRes.ok) {
      final_output = { state: 'error', error: await turnRes.text() };
      break;
    }

    final_output = (await turnRes.json()) as Record<string, unknown>;
    const state = final_output.state as string;

    if (state === 'conclusion') {
      concluded = true;
      cause_id = (final_output.cause_id as string) ?? null;
      break;
    }
    if (state === 'escalation' || state === 'non_convergent') {
      break;
    }

    nextAction = (final_output.next_action as string) ?? null;
  }

  if (!concluded && !final_output.state) {
    final_output = { state: 'non_convergent', path };
  }

  return buildRunRecord({
    c,
    arm: armLabel,
    replicate,
    path,
    concluded,
    cause_id,
    turns,
    final_output,
    hypotheses_initial: hypothesesInitial,
    hypotheses_final: Array.isArray(final_output.hypotheses_ranked)
      ? (final_output.hypotheses_ranked as Array<{ id: string; prior: number }>)
      : undefined,
  });
}

async function main() {
  const baseUrl = (process.env.BENCH_API_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const apiKey = process.env.BENCH_API_KEY;
  if (!apiKey) {
    console.error('Définir BENCH_API_URL et BENCH_API_KEY');
    process.exit(1);
  }

  const armLabel = arg('arm') ?? 'D';
  const casesPath = arg('cases');
  const cases = loadV2Cases(casesPath) as PilotCaseExtended[];
  const replicates = Number(arg('replicates') ?? process.env.BENCH_REPLICATES ?? 1);
  const runId = newRunId(`pilot-v2-${armLabel.toLowerCase()}`);
  const outDir = resolve(import.meta.dirname, `../runs/${runId}`);
  mkdirSync(outDir, { recursive: true });

  const records = [];
  for (const c of cases) {
    for (let rep = 0; rep < replicates; rep++) {
      const rec = await runCase(baseUrl, apiKey, runId, c, rep, armLabel);
      records.push(rec);
      console.log(`${c.id} rep${rep}: path=${rec.path.join('→')} concluded=${rec.concluded}`);
    }
  }

  writeFileSync(resolve(outDir, 'raw.jsonl'), records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const scores = scoreV2RunDual(cases, records);
  writeFileSync(resolve(outDir, 'score-d.json'), JSON.stringify(scores.current, null, 2));
  writeFileSync(resolve(outDir, 'score-d-legacy.json'), JSON.stringify(scores.legacy, null, 2));
  writeFileSync(
    resolve(outDir, 'manifest.json'),
    JSON.stringify(
      {
        ...buildRunManifestBase(armLabel, runId, replicates, cases.length, {
          priors_source: armLabel === 'D_star' ? 'pilot_cases' : 'production_mined',
        }),
        endpoint: `${baseUrl}/api/v2/diagnose/session`,
        scorer_version: scores.current.scorer_version,
        scorer_legacy_version: scores.legacy.scorer_version,
        preregistration_hash: loadPreregistrationHash(),
      },
      null,
      2,
    ) + '\n',
  );

  console.log(`Arm ${armLabel} metrics:`, scores.current);
  console.log(`Wrote ${records.length} records to ${outDir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
