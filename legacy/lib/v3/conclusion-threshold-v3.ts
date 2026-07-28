import { readFileSync } from 'node:fs';

import { PATHS } from './paths.js';

export type ConclusionThresholdV3Config = {
  version: string;
  default_threshold: number;
  calibrated_threshold: number | null;
  calibrated_on: string | null;
  calibrated_at: string | null;
  note?: string;
};

let cached: ConclusionThresholdV3Config | null = null;

export function loadConclusionThresholdV3Config(
  refresh = false,
): ConclusionThresholdV3Config {
  if (cached && !refresh) return cached;
  const path = PATHS.conclusionThresholdV3;
  try {
    cached = JSON.parse(readFileSync(path, 'utf8')) as ConclusionThresholdV3Config;
  } catch {
    cached = {
      version: 'conclusion-threshold-v3.fallback',
      default_threshold: 0.85,
      calibrated_threshold: null,
      calibrated_on: null,
      calibrated_at: null,
    };
  }
  return cached;
}

/** Seuil de conclusion v3 — calibré sur Neon dev si disponible. */
export function getConclusionThresholdV3(override?: number): number {
  if (override !== undefined) return override;
  const cfg = loadConclusionThresholdV3Config();
  return cfg.calibrated_threshold ?? cfg.default_threshold;
}
