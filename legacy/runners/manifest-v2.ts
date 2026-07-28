import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadModelsV2Config, type ModelsV2Config } from './models-v2.js';

export type LikelihoodsV2Config = {
  version: string;
  likelihoods: { support: number; refute: number; unrelated: number; eliminate: number };
  matrix_version: string;
  T_cutoff: string;
  conclusion_threshold?: number;
  conclusion_threshold_status?: 'pending_matrix' | 'calibrated';
  calibration?: {
    status?: 'pending_matrix' | 'calibrated';
    fitted_on?: 'pilot' | 'held_out';
    fitted_at?: string;
    sweep?: { min: number; max: number; step: number };
    premature_closure_rate_max?: number;
    conv_at_5_at_fit?: number;
    notes?: string;
  };
};

export type KnowledgeV3Manifest = {
  version: string;
  T_cutoff: string;
  knowledge_authored_at: string;
  knowledge_sources: string[];
  marcel_review?: {
    date: string;
    artifact: string;
    pending_artifact?: string;
    parity_script?: string;
    edges_marcel_sourced?: number;
    edges_draft_retained?: number;
    arbiter?: string;
    notes?: string;
  };
};

export type V2RunManifestBase = {
  mode: 'live';
  arm: string;
  models_config: string;
  models_version: string;
  likelihoods_config?: string;
  likelihoods_version?: string;
  matrix_version?: string;
  T_cutoff: string;
  priors_source?: 'production_mined' | 'pilot_cases';
  assisted_priors?: boolean;
  temperature?: number;
  model_id?: string;
  run_id: string;
  replicates: number;
  cases: number;
  created_at: string;
  oracles?: Record<string, unknown>;
  conclusion_threshold?: number;
  conclusion_threshold_status?: 'pending_matrix' | 'calibrated';
  calibration?: LikelihoodsV2Config['calibration'];
  knowledge_v3?: KnowledgeV3Manifest;
};

export function buildRunManifestBase(
  arm: string,
  runId: string,
  replicates: number,
  cases: number,
  extras?: {
    priors_source?: 'production_mined' | 'pilot_cases';
    assisted_priors?: boolean;
    knowledge_v3?: KnowledgeV3Manifest;
  },
): V2RunManifestBase {
  const cfg = loadModelsV2Config();
  const lik = loadLikelihoodsV2Config();
  const knowledge = extras?.knowledge_v3 ?? loadKnowledgeV3Manifest();
  return {
    mode: 'live',
    arm,
    models_config: 'config/models-v2.json',
    models_version: cfg.version,
    likelihoods_config: 'config/likelihoods-v2.json',
    likelihoods_version: lik.version,
    matrix_version: lik.matrix_version,
    T_cutoff: computeTCutoff(cfg),
    conclusion_threshold: lik.conclusion_threshold,
    conclusion_threshold_status: lik.conclusion_threshold_status,
    calibration: lik.calibration,
    run_id: runId,
    replicates,
    cases,
    created_at: new Date().toISOString(),
    knowledge_v3: knowledge,
    ...extras,
  };
}

export function computeTCutoff(cfg?: ModelsV2Config): string {
  const config = cfg ?? loadModelsV2Config();
  const dates: string[] = [];
  if (config.knowledge_cutoff) dates.push(config.knowledge_cutoff);
  for (const arm of Object.values(config.arms)) {
    const armCfg = arm as { knowledge_cutoff?: string };
    if (armCfg.knowledge_cutoff) dates.push(armCfg.knowledge_cutoff);
  }
  return dates.sort().pop() ?? config.version;
}

export function loadLikelihoodsV2Config(): LikelihoodsV2Config {
  const path = resolve(import.meta.dirname, '../config/likelihoods-v2.json');
  return JSON.parse(readFileSync(path, 'utf8')) as LikelihoodsV2Config;
}

export function loadKnowledgeV3Manifest(): KnowledgeV3Manifest {
  const path = resolve(import.meta.dirname, '../config/knowledge-v3-manifest.json');
  return JSON.parse(readFileSync(path, 'utf8')) as KnowledgeV3Manifest;
}
