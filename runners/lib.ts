import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { BenchCase, ConfidenceBand, RunArtifact, RunRecord } from '../scorer/types.js';

export function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export function loadCases(casesPath: string): BenchCase[] {
  const raw = readFileSync(resolve(casesPath), 'utf8');
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as BenchCase);
}

export function datasetVersion(casesPath: string): string {
  return createHash('sha256').update(readFileSync(resolve(casesPath))).digest('hex').slice(0, 16);
}

export function parseBand(raw: unknown): ConfidenceBand {
  if (raw === 'high' || raw === 'medium' || raw === 'low') return raw;
  return 'unknown';
}

export function buildUserMessage(c: BenchCase): string {
  const parts = [c.prompt.user_message];
  const hints: string[] = [];
  if (c.prompt.brand_hint) hints.push(`Marque : ${c.prompt.brand_hint}`);
  if (c.prompt.model_hint) hints.push(`Modèle : ${c.prompt.model_hint}`);
  if (c.prompt.error_code_hint) hints.push(`Code : ${c.prompt.error_code_hint}`);
  if (hints.length) parts.push(`\nContexte : ${hints.join(' · ')}`);
  return parts.join('');
}

export function extractConfidence(answer: Record<string, unknown>): {
  band: ConfidenceBand;
  score: number | null;
} {
  const raw = answer.diagnostic_confidence;
  if (!raw || typeof raw !== 'object') return { band: 'unknown', score: null };
  const band = parseBand((raw as Record<string, unknown>).band);
  const scoreRaw = (raw as Record<string, unknown>).score;
  const score = typeof scoreRaw === 'number' ? scoreRaw : null;
  return { band, score };
}

export function stripBenchFields(answer: Record<string, unknown>): Record<string, unknown> {
  const { diagnostic_confidence: _dc, ...rest } = answer;
  return rest;
}

export function makeRunArtifact(args: {
  runId: string;
  arm: RunArtifact['arm'];
  casesPath: string;
  endpoint: string;
  n: number;
  startedAt: string;
  contractVersion: string | null;
  indexVersion?: string | null;
}): RunArtifact {
  return {
    run_id: args.runId,
    arm: args.arm,
    contract_version: args.contractVersion,
    dataset_version: datasetVersion(args.casesPath),
    index_version: args.indexVersion ?? null,
    started_at: args.startedAt,
    finished_at: new Date().toISOString(),
    endpoint: args.endpoint,
    n: args.n,
  };
}

export function newRunId(prefix: string): string {
  return `${prefix}-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
}

export type { RunRecord };
