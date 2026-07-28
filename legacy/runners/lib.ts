import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { BenchCase, ConfidenceBand, RunArtifact, RunRecord } from '../scorer/types.js';
import { loadModelsV2Config } from './models-v2.js';

export function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export function loadCases(casesPath: string): BenchCase[] {
  const paths = casesPath.split(',').map((p) => p.trim()).filter(Boolean);
  if (paths.length > 1) return loadCasesFromPaths(paths);
  const raw = readFileSync(resolve(casesPath), 'utf8');
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as BenchCase);
}

/** Charge plusieurs JSONL (bench complet = gate + bench-v2 + sample). */
export function loadCasesFromPaths(paths: string[]): BenchCase[] {
  const cases: BenchCase[] = [];
  const seen = new Set<string>();
  for (const p of paths) {
    for (const c of loadCases(p)) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      cases.push(c);
    }
  }
  return cases.sort((a, b) => a.id.localeCompare(b.id));
}

export const BENCH_FULL_PATHS = [
  '../hvac-bench-heldout/dataset/gate.jsonl',
  '../hvac-bench/dataset/public/bench-v2.jsonl',
  '../hvac-bench/dataset/public/sample.jsonl',
];

export function datasetVersion(casesPath: string): string {
  const paths = casesPath.split(',').map((p) => p.trim()).filter(Boolean);
  const hash = createHash('sha256');
  for (const p of paths) {
    hash.update(readFileSync(resolve(p)));
  }
  return hash.digest('hex').slice(0, 16);
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
  const { diagnostic_confidence: _dc, search_notes: _sn, ...rest } = answer;
  return rest;
}

export function extractJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
    return null;
  }
}

export type OpenRouterArmConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  arm: 'A' | 'B' | 'C' | 'E';
  title: string;
  temperature: number;
};

export function resolveOpenRouterArmConfig(arm: 'A' | 'B' | 'E'): OpenRouterArmConfig {
  const env = (key: string) => process.env[`BENCH_ARM_${arm}_${key}`];
  const apiKey = env('API_KEY') ?? process.env.OPENROUTER_API_KEY ?? process.env.OPENAI_API_KEY;
  const baseUrl = (env('BASE_URL') ?? 'https://openrouter.ai/api/v1').replace(/\/$/, '');
  const cfg = loadModelsV2Config();
  const armCfg = cfg.arms[arm];
  const model = env('MODEL') ?? armCfg?.openrouter_slug;
  if (!model) {
    console.error(`Arm ${arm} : définir BENCH_ARM_${arm}_MODEL ou config/models-v2.json`);
    process.exit(1);
  }
  if (cfg.forbidden_defaults.some((f) => model.toLowerCase().includes(f.toLowerCase()))) {
    console.error(`Modèle interdit (legacy) : ${model}. Utiliser la stack 2026 (models-v2.json).`);
    process.exit(1);
  }
  if (!apiKey) {
    console.error(`Définir BENCH_ARM_${arm}_API_KEY, OPENROUTER_API_KEY ou OPENAI_API_KEY.`);
    process.exit(1);
  }
  return {
    apiKey,
    baseUrl,
    model,
    arm,
    title: `hvac-bench-arm-${arm.toLowerCase()}`,
    temperature: cfg.temperature,
  };
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
