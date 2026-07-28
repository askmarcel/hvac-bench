/**
 * Bras de calibration — O_plomberie (tautologique), O_plafond, R
 *
 * O_plomberie rejoue expert_path action par action — ce n'est PAS le moteur bayésien.
 * Pour l'oracle bayésien : O_bayes (baseline documentée conv@5=0,80) et O_bayes_db (matrice Supabase).
 *
 * Usage:
 *   pnpm run:v2:arm-o-plumbing
 *   pnpm run:v2:arm-o-ceiling   # OPENROUTER_API_KEY
 *   pnpm run:v2:arm-r
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { scoreV2RunDual } from '../scorer/v2/index.js';
import { extractJson, newRunId } from './lib.js';
import { loadPreregistrationHash } from './preregistration.js';
import { resolveV2ArmModel } from './models-v2.js';
import {
  diagnosticActionIds,
  loadV2Cases,
  lookupObservation,
  runInteractiveLoop,
  trueCauseId,
  type PilotCaseExtended,
} from './v2-harness.js';

type CalArm = 'O_plumbing' | 'O_ceiling' | 'R';

function parseArm(): CalArm {
  const idx = process.argv.indexOf('--arm');
  const raw = idx >= 0 ? process.argv[idx + 1] : 'O_plumbing';
  if (raw === 'O_plumbing' || raw === 'O_ceiling' || raw === 'R') return raw;
  console.error('Arm calibration : --arm O_plumbing | O_ceiling | R');
  process.exit(1);
}

function runOPlumbing(c: PilotCaseExtended, replicate: number) {
  let step = 0;
  return runInteractiveLoop({
    c,
    arm: 'O_plumbing',
    replicate,
    pickAction: ({ c: caseRow }) => {
      const next = caseRow.expert_path[step];
      if (!next) return null;
      step++;
      return next;
    },
  });
}

function seededRandom(caseId: string, replicate: number, turn: number): number {
  const h = createHash('sha256').update(`${caseId}:${replicate}:${turn}`).digest();
  return h[0]! / 255;
}

function runR(c: PilotCaseExtended, replicate: number) {
  const pool = diagnosticActionIds();
  const executed = new Set<string>();
  return runInteractiveLoop({
    c,
    arm: 'R',
    replicate,
    pickAction: ({ c: caseRow, turns }) => {
      const available = pool.filter((id) => !executed.has(id));
      if (!available.length) return null;
      const idx = Math.floor(seededRandom(caseRow.id, replicate, turns) * available.length);
      const pick = available[idx]!;
      executed.add(pick);
      return pick;
    },
  });
}

async function callCeilingLlm(
  model: string,
  temperature: number,
  apiKey: string,
  c: PilotCaseExtended,
): Promise<{ cause_id: string | null; raw: string; error?: string }> {
  const observations = c.expert_path.map((actionId) => {
    const { observation } = lookupObservation(c, actionId);
    return `- ${actionId}: ${observation}`;
  });
  const hypotheses = c.hypotheses.map((h) => `${h.id}: ${h.label ?? h.id}`).join('\n');
  const user = [
    `Symptôme : ${c.symptom.narrative}`,
    `Équipement : ${c.context.equipment_type}`,
    `Code : ${c.symptom.code_present ?? 'aucun'}`,
    '\nObservations (chemin expert complet) :',
    observations.join('\n'),
    '\nHypothèses possibles :',
    hypotheses,
    '\nRéponds en JSON : {"cause_id":"<id>"}',
  ].join('\n');

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://askmarcel.app',
      'X-Title': 'hvac-bench-calibration',
    },
    body: JSON.stringify({
      model,
      temperature,
      messages: [
        {
          role: 'system',
          content:
            'Tu es un expert HVAC. À partir des observations fournies, identifie la cause la plus probable parmi les hypothèses listées. JSON strict uniquement.',
        },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) {
    return { cause_id: null, raw: await res.text(), error: `http_${res.status}` };
  }
  const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const raw = body.choices?.[0]?.message?.content ?? '';
  const parsed = extractJson(raw);
  const cause_id = typeof parsed?.cause_id === 'string' ? parsed.cause_id : null;
  return { cause_id, raw };
}

async function runOCeiling(
  c: PilotCaseExtended,
  replicate: number,
  model: string,
  temperature: number,
  apiKey: string,
) {
  const { cause_id, raw, error } = await callCeilingLlm(model, temperature, apiKey, c);
  const expected = trueCauseId(c);
  const ok = cause_id === expected;
  return {
    case_id: c.id,
    replicate,
    arm: 'O_ceiling' as const,
    path: [...c.expert_path],
    concluded: ok,
    cause_id,
    true_cause_id: expected,
    turns: c.expert_path.length,
    final_output: {
      state: ok ? 'conclusion' : 'non_convergent',
      cause_id,
      raw_llm: raw.slice(0, 500),
      error,
    },
    format_fail: Boolean(error),
  };
}

async function main() {
  const arm = parseArm();
  const cases = loadV2Cases() as PilotCaseExtended[];
  const replicates = arm === 'R' ? 1 : Number(process.env.BENCH_REPLICATES ?? 1);
  const runId = newRunId(`cal-${arm.toLowerCase()}`);
  const outDir = resolve(import.meta.dirname, `../runs/${runId}`);
  mkdirSync(outDir, { recursive: true });

  const records = [];
  if (arm === 'O_plumbing') {
    for (const c of cases) {
      for (let rep = 0; rep < replicates; rep++) {
        const rec = runOPlumbing(c, rep);
        records.push(rec);
        console.log(`${c.id} rep${rep}: ${rec.path.join('→')} → ${rec.final_output.state}`);
      }
    }
  } else if (arm === 'R') {
    for (const c of cases) {
      for (let rep = 0; rep < replicates; rep++) {
        const rec = runR(c, rep);
        records.push(rec);
        console.log(`${c.id}: ${rec.path.join('→') || '—'} → ${rec.final_output.state}`);
      }
    }
  } else {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      console.error('O_ceiling : définir OPENROUTER_API_KEY');
      process.exit(1);
    }
    const { model, temperature } = resolveV2ArmModel('B');
    for (const c of cases) {
      const rec = await runOCeiling(c, 0, model, temperature, apiKey);
      records.push(rec);
      console.log(`${c.id}: cause=${rec.cause_id} expected=${rec.true_cause_id} ok=${rec.concluded}`);
    }
  }

  const scores = scoreV2RunDual(cases, records);
  const scoreFile =
    arm === 'O_plumbing' ? 'score-o-plumbing.json' : arm === 'O_ceiling' ? 'score-o-ceiling.json' : 'score-r.json';
  writeFileSync(resolve(outDir, scoreFile), JSON.stringify(scores.current, null, 2));
  writeFileSync(resolve(outDir, 'score-legacy.json'), JSON.stringify(scores.legacy, null, 2));
  writeFileSync(resolve(outDir, 'raw.jsonl'), records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  writeFileSync(
    resolve(outDir, 'manifest.json'),
    JSON.stringify(
      {
        mode: 'calibration',
        arm,
        run_id: runId,
        replicates,
        cases: cases.length,
        scorer_version: scores.current.scorer_version,
        scorer_legacy_version: scores.legacy.scorer_version,
        preregistration_hash: loadPreregistrationHash(),
        created_at: new Date().toISOString(),
      },
      null,
      2,
    ) + '\n',
  );

  console.log(`Arm ${arm}:`, scores.current);
  console.log(`Wrote ${records.length} records to ${outDir}`);

  if (arm === 'O_plumbing' && scores.current.convergence_at_5 < 1) {
    console.error('O_plomberie < 100 % — harnais ou cas invalides.');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
