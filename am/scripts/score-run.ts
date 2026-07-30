#!/usr/bin/env tsx
/**
 * am:score — agrège transcripts (raw.jsonl) + juge LLM + scorer mécanique.
 *
 * Usage:
 *   pnpm am:score --run runs/am-prod-<ts>
 *   pnpm am:score --run runs/am-prod-<ts> --skip-judge   # mécanique seul (sans clé juge)
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { judgeTranscript, type JudgeGrade, type Verite } from '../judge/judge.js';
import { loadCasesForSplit } from '../runner/manifest.js';
import {
  aggregateRate,
  scoreTranscript,
  type AmCaseForScoring,
  type MechanicalScore,
  type RunTranscript,
} from '../scorer/mechanical.js';
import { toRunTranscript } from '../runner/transcript-types.js';
import { MissingApiKeyError } from '../llm-client.js';

const AM_ROOT = resolve(import.meta.dirname, '..');
const HVAC_BENCH_ROOT = resolve(AM_ROOT, '..');
const TAXONOMY_PATH = resolve(HVAC_BENCH_ROOT, 'taxonomy/quantities-v3.json');

import type { TranscriptRecord } from '../runner/transcript-types.js';

type RawRecord = TranscriptRecord;

type RunManifest = {
  run_id: string;
  arm: 'L0' | 'LW' | 'PROD';
  split: 'dev' | 'gate';
  replicates: number;
};

type CaseFile = AmCaseForScoring & {
  verite: Verite;
  installation?: { emetteur?: string };
};

function withEmitterCondition(record: RawRecord, emetteur?: string): RawRecord {
  if (!emetteur) return record;
  return {
    ...record,
    turns: record.turns.map((turn) => {
      if (!turn.plages_annoncees?.length) return turn;
      return {
        ...turn,
        plages_annoncees: turn.plages_annoncees.map((p) => ({
          ...p,
          condition: p.condition ?? emetteur,
        })),
      };
    }),
  };
}

type ScoredReplicate = {
  case_id: string;
  replicate: number;
  status: RawRecord['status'];
  blocked_reason?: string;
  judge: JudgeGrade | null;
  judge_error?: string;
  mechanical: MechanicalScore | null;
  transcript_text: string;
};

type ScoreOutput = {
  run_id: string;
  arm: RunManifest['arm'];
  split: RunManifest['split'];
  scored_at: string;
  n_records: number;
  n_completed: number;
  replicates: ScoredReplicate[];
  aggregates: {
    cause_ok_rate: number | null;
    solution_ok_rate: number | null;
    piege_rate: number | null;
    valeur_attendue_annoncee_rate: number | null;
    escalade_ok_rate: number | null;
    conclusion_sans_mesure_rate: number | null;
    hallucination_plage_rate: number | null;
    median_nb_tours: number | null;
  };
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function formatTranscriptText(turns: RawRecord['turns']): string {
  return turns.map((t) => `${t.role === 'technicien' ? 'Technicien' : 'Installateur'}: ${t.content}`).join('\n\n');
}

function toRunTranscriptFromRecord(record: RawRecord): RunTranscript {
  return toRunTranscript(record);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function loadCaseMap(split: 'dev' | 'gate'): Map<string, CaseFile> {
  const map = new Map<string, CaseFile>();
  for (const { content } of loadCasesForSplit(split)) {
    const c = JSON.parse(content) as CaseFile;
    map.set(c.id, c);
  }
  return map;
}

async function main() {
  const runDir = arg('run');
  if (!runDir) {
    console.error('Usage: pnpm am:score --run <dossier-run> [--skip-judge]');
    process.exit(1);
  }

  const absRunDir = resolve(runDir);
  const manifestPath = resolve(absRunDir, 'manifest.json');
  const rawPath = resolve(absRunDir, 'raw.jsonl');

  if (!existsSync(manifestPath) || !existsSync(rawPath)) {
    console.error(`Run incomplet : manifest.json et raw.jsonl requis dans ${absRunDir}`);
    process.exit(1);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as RunManifest;
  const records = readFileSync(rawPath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RawRecord);

  const caseMap = loadCaseMap(manifest.split);
  const taxonomy = JSON.parse(readFileSync(TAXONOMY_PATH, 'utf8'));
  const skipJudge = hasFlag('skip-judge');

  const scored: ScoredReplicate[] = [];

  for (const record of records) {
    const amCase = caseMap.get(record.case_id);
    const transcriptText = formatTranscriptText(record.turns);

    if (record.status !== 'completed' || !amCase) {
      scored.push({
        case_id: record.case_id,
        replicate: record.replicate,
        status: record.status,
        blocked_reason: record.blocked_reason,
        judge: null,
        mechanical: null,
        transcript_text: transcriptText,
      });
      continue;
    }

    let judge: JudgeGrade | null = null;
    let judgeError: string | undefined;
    if (!skipJudge) {
      try {
        judge = await judgeTranscript({ verite: amCase.verite, transcript: transcriptText });
      } catch (e) {
        if (e instanceof MissingApiKeyError) {
          console.error(`\n🚫 ${e.message}`);
          console.error('Relancer avec --skip-judge pour scorer uniquement le mécanique.');
          process.exit(2);
        }
        judgeError = e instanceof Error ? e.message : String(e);
      }
    }

    const mechanical = scoreTranscript(
      toRunTranscriptFromRecord(
        withEmitterCondition(
          record,
          typeof amCase.installation?.emetteur === 'string'
            ? amCase.installation.emetteur
            : undefined,
        ),
      ),
      amCase,
      taxonomy,
      manifest.arm,
    );

    scored.push({
      case_id: record.case_id,
      replicate: record.replicate,
      status: record.status,
      judge,
      judge_error: judgeError,
      mechanical,
      transcript_text: transcriptText,
    });
  }

  const completed = scored.filter((s) => s.status === 'completed');
  const judgeGrades = completed.map((s) => s.judge).filter((j): j is JudgeGrade => j != null);

  const output: ScoreOutput = {
    run_id: manifest.run_id,
    arm: manifest.arm,
    split: manifest.split,
    scored_at: new Date().toISOString(),
    n_records: records.length,
    n_completed: completed.length,
    replicates: scored,
    aggregates: {
      cause_ok_rate: aggregateRate(judgeGrades.map((j) => j.cause_ok)),
      solution_ok_rate: aggregateRate(judgeGrades.map((j) => j.solution_ok)),
      piege_rate: aggregateRate(judgeGrades.map((j) => j.piege)),
      valeur_attendue_annoncee_rate: aggregateRate(judgeGrades.map((j) => j.valeur_attendue_annoncee)),
      escalade_ok_rate: aggregateRate(
        completed.map((s) => s.mechanical?.escalade_ok ?? null),
      ),
      conclusion_sans_mesure_rate: aggregateRate(
        completed.map((s) => s.mechanical?.conclusion_sans_mesure ?? null),
      ),
      hallucination_plage_rate: aggregateRate(
        completed.map((s) => s.mechanical?.hallucination_plage ?? null),
      ),
      median_nb_tours: median(completed.map((s) => s.mechanical?.nb_tours ?? 0)),
    },
  };

  const outPath = resolve(absRunDir, 'score.json');
  writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`Score écrit: ${outPath}`);
  console.log(JSON.stringify(output.aggregates, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
