/**
 * Exporte le pack d'annotation workflow Phase 4 (30 cas hb-0130–hb-0159).
 *
 * Usage :
 *   pnpm exec tsx scripts/export-workflow-pack.ts
 *   pnpm exec tsx scripts/export-workflow-pack.ts --run runs/bench-v2-full-d-2026-07-26/raw.jsonl
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadCases } from '../runners/lib.js';
import type { BenchCase, RunRecord } from '../scorer/types.js';

const WORKFLOW_IDS = [
  'hb-0130', 'hb-0131', 'hb-0132', 'hb-0133', 'hb-0134', 'hb-0135', 'hb-0136', 'hb-0137',
  'hb-0138', 'hb-0139', 'hb-0140', 'hb-0141', 'hb-0142', 'hb-0143', 'hb-0144', 'hb-0145',
  'hb-0146', 'hb-0147', 'hb-0148', 'hb-0149', 'hb-0150', 'hb-0151', 'hb-0152', 'hb-0153',
  'hb-0154', 'hb-0155', 'hb-0156', 'hb-0157', 'hb-0158', 'hb-0159',
];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function readJsonl<T>(path: string): T[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as T);
}

function main() {
  const benchPath = resolve('../hvac-bench/dataset/public/bench-v2.jsonl');
  const cases = loadCases(benchPath).filter((c) => WORKFLOW_IDS.includes(c.id));
  if (cases.length !== WORKFLOW_IDS.length) {
    throw new Error(`Attendu ${WORKFLOW_IDS.length} cas workflow, obtenu ${cases.length}`);
  }

  const runPath = arg('run');
  const records = runPath ? new Map(readJsonl<RunRecord>(resolve(runPath)).map((r) => [r.case_id, r])) : null;

  const pack = cases.map((c) => {
    const record = records?.get(c.id);
    const answer = record?.answer as Record<string, unknown> | null;
    const steps = (answer?.steps as Array<{ order: number; text: string }> | undefined) ?? [];
    return {
      case_id: c.id,
      prompt: c.prompt.user_message,
      brand_hint: c.prompt.brand_hint,
      error_code_hint: c.prompt.error_code_hint,
      ground_truth_meaning: c.ground_truth.expected_meaning,
      ground_truth_source: c.ground_truth.source,
      prod_response_summary: answer
        ? {
            state: answer.state,
            cause: typeof answer.cause === 'string' ? answer.cause.slice(0, 500) : null,
            steps: steps.map((s) => s.text).slice(0, 8),
            citation: answer.citation ?? null,
          }
        : null,
      annotation: {
        ordre_simple_invasif: null as number | null,
        coherence_metier: null as number | null,
        completude: null as number | null,
        notes: '' as string,
        annotator: '' as string,
        annotated_at: '' as string,
      },
    };
  });

  const outDir = resolve('workflow');
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, 'phase4-annotation-pack.json');
  writeFileSync(outPath, JSON.stringify({ generated_at: new Date().toISOString(), n: pack.length, cases: pack }, null, 2), 'utf8');

  const csvHeader =
    'case_id,ordre_simple_invasif,coherence_metier,completude,notes,annotator,annotated_at';
  const csvRows = pack.map((p) =>
  `${p.case_id},,,,,"",""`,
  );
  writeFileSync(resolve(outDir, 'phase4-annotation-template.csv'), `${csvHeader}\n${csvRows.join('\n')}\n`, 'utf8');

  console.log(`→ ${outPath}`);
  console.log(`→ ${resolve(outDir, 'phase4-annotation-template.csv')}`);
  console.log(`${pack.length} cas — remplir scores 1–5 ou laisser vide`);
}

main();
