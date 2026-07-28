import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
  voi?: {
    scoring: string;
    lambda_cost_bits_per_eur: number;
    min_gain_epsilon: number;
  };
  notes?: string;
};

let cached: LikelihoodsV2Config | null = null;

export function loadLikelihoodsV2Config(refresh = false): LikelihoodsV2Config {
  if (cached && !refresh) return cached;
  const path = resolve(import.meta.dirname, '../config/likelihoods-v2.json');
  cached = JSON.parse(readFileSync(path, 'utf8')) as LikelihoodsV2Config;
  return cached;
}

export function getConclusionThreshold(override?: number): number {
  if (override !== undefined) return override;
  return loadLikelihoodsV2Config().conclusion_threshold ?? 0.85;
}

export function getLikelihoodFactors(): LikelihoodsV2Config['likelihoods'] {
  return loadLikelihoodsV2Config().likelihoods;
}
