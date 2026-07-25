/**
 * Scorer HVAC Bench — transforme un artefact de run en scores.
 *
 * Usage :
 *   tsx scorer/index.ts --cases <gate.jsonl> --run <raw.jsonl> --index <corpus-index.json>
 *                       [--meta <run.json>] [--out <score.json>]
 *
 * Déterministe : mêmes entrées, mêmes sorties. Aucun appel réseau, aucun LLM (NFR-4).
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { computeMetrics, computeSlices, type Metrics, type Slices } from './aggregate.js';
import { checkFormat } from './contract.js';
import {
  computeMeaningOverlap,
  scoreAbstention,
  scoreAttribution,
  scoreCitation,
  scoreCodeAccuracy,
  scoreSafety,
} from './rubrics.js';
import type { BenchCase, BenchIndex, CaseScore, RunArtifact, RunRecord } from './types.js';

export type ScoreReport = {
  run_id: string;
  contract_version: string | null;
  arm: string;
  dataset_version: string;
  index_version: string | null;
  scorer_version: string;
  n: number;
  metrics: Metrics;
  slices: Slices;
  confidence_intervals: { method: 'wilson'; level: 0.95 };
  cases: CaseScore[];
};

export const SCORER_VERSION = '0.1.0';

function readJsonl<T>(path: string): T[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as T);
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16);
}

export function scoreRun(params: {
  cases: BenchCase[];
  records: RunRecord[];
  index: BenchIndex;
  meta?: Partial<RunArtifact>;
  datasetVersion: string;
  indexVersion: string | null;
}): ScoreReport {
  const { cases, records, index } = params;
  const byId = new Map(records.map((r) => [r.case_id, r]));

  const phantomIds = new Set<string>();
  const scores: CaseScore[] = cases.map((c) => {
    const record = byId.get(c.id) ?? null;
    const format = checkFormat(record?.answer ?? null);
    const observed = format.observed;
    const band = record?.confidence.band ?? 'unknown';

    const citation = scoreCitation(c, observed, index);
    if (citation.phantom) phantomIds.add(c.id);

    return {
      case_id: c.id,
      strata: c.strata,
      no_answer_kind: c.no_answer_kind,
      gate_critical: c.flags.gate_critical,
      contamination_risk: c.flags.contamination_risk,
      corpus_leakage: c.flags.corpus_leakage,
      observed_state: observed?.state ?? null,
      confidence_band: band,
      format_compliant: format.compliant,
      format_reason: format.reason,
      rubrics: {
        attribution: scoreAttribution(c, observed, index),
        code_accuracy: scoreCodeAccuracy(c, observed),
        citation: { verdict: citation.verdict, reason: citation.reason },
        abstention: scoreAbstention(c, observed, band),
        safety: scoreSafety(c, observed),
      },
      signals: {
        meaning_overlap: computeMeaningOverlap(c, observed),
        citation_matches_ground_truth: citation.matchesGroundTruth,
        state_matches_expected: observed ? observed.state === c.ground_truth.expected_state : null,
      },
    };
  });

  return {
    run_id: params.meta?.run_id ?? 'inconnu',
    contract_version: params.meta?.contract_version ?? null,
    arm: params.meta?.arm ?? 'D',
    dataset_version: params.datasetVersion,
    index_version: params.indexVersion,
    scorer_version: SCORER_VERSION,
    n: scores.length,
    metrics: computeMetrics(scores, [...phantomIds]),
    slices: computeSlices(scores, phantomIds),
    confidence_intervals: { method: 'wilson', level: 0.95 },
    cases: scores,
  };
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function pct(r: { rate: number | null; ci95: [number, number] | null; passed: number; total: number }): string {
  if (r.rate === null) return 'n/a';
  const ci = r.ci95 ? ` [${(r.ci95[0] * 100).toFixed(1)}–${(r.ci95[1] * 100).toFixed(1)}]` : '';
  return `${(r.rate * 100).toFixed(1)} %${ci}  (${r.passed}/${r.total})`;
}

function main() {
  const casesPath = arg('cases') ?? '../hvac-bench-heldout/dataset/gate.jsonl';
  const runPath = arg('run');
  const indexPath = arg('index') ?? '../hvac-bench-heldout/index/corpus-index.json';
  if (!runPath) {
    console.error('--run <raw.jsonl> est requis.');
    process.exit(1);
  }

  const cases = readJsonl<BenchCase>(resolve(casesPath));
  const records = readJsonl<RunRecord>(resolve(runPath));
  const index = JSON.parse(readFileSync(resolve(indexPath), 'utf8')) as BenchIndex;
  const metaPath = arg('meta');
  const meta = metaPath ? (JSON.parse(readFileSync(resolve(metaPath), 'utf8')) as RunArtifact) : undefined;

  const report = scoreRun({
    cases,
    records,
    index,
    meta,
    datasetVersion: sha256(resolve(casesPath)),
    indexVersion: index.exported_at ?? null,
  });

  const out = resolve(arg('out') ?? 'runs/score.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 2), 'utf8');

  const m = report.metrics;
  console.log(`\nHVAC Bench — bras ${report.arm} · run ${report.run_id} · ${report.n} cas`);
  console.log(`dataset ${report.dataset_version} · scorer ${report.scorer_version}\n`);
  console.log(`  conformité format   ${pct(m.format_compliance_rate)}`);
  console.log(`  attribution         ${pct(m.attribution_rate)}`);
  console.log(`  exactitude code     ${pct(m.code_accuracy_rate)}`);
  console.log(`  citation            ${pct(m.citation_rate)}`);
  console.log(`  abstention          ${pct(m.abstention_rate)}`);
  console.log(`  hallucination       ${pct(m.hallucination_rate)}`);
  console.log(`  réponse utile       ${pct(m.useful_answer_rate)}`);
  console.log(`\n  erreurs confiance haute : ${m.high_confidence_error_count}`);
  console.log(`  citations fantômes      : ${m.phantom_citation_count}`);
  console.log(`  échecs sécurité         : ${m.safety_fail_count}`);
  if (m.confidence_unknown_count > 0) {
    console.log(
      `\n  ⚠ confiance illisible sur ${m.confidence_unknown_count} cas : la règle « high sur no-answer » ne couvre pas ces cas.`,
    );
  }
  console.log(`\n→ ${out}`);
}

// N'exécute le CLI que si ce fichier est le point d'entrée : le module est aussi importé
// par les tests et par gate/run.ts.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
