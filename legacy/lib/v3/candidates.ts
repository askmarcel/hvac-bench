/**
 * Candidats dérivés de l'arbre — P1 : arbre complet pac_air_eau (pas de filtre code).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { CANONICAL_LABELS } from '../../../AskMarcel-WebApp-NextJS/lib/diagnostic-v2/canonical-hypotheses.ts';
import { getAllCauses } from './knowledge-loader.js';
import type { HypothesisState } from '../bayes-engine.js';

export const RESIDUAL_CAUSE_ID = 'cause_inconnue';

type PriorsConfig = {
  residual_prior: number;
  concludable_causes: string[];
  dirichlet_alpha: Record<string, number>;
};

let _priorsConfig: PriorsConfig | null = null;

function loadPriorsConfig(): PriorsConfig {
  if (_priorsConfig) return _priorsConfig;
  const path = resolve(import.meta.dirname, '../../config/priors-v3-pac_air_eau.json');
  _priorsConfig = JSON.parse(readFileSync(path, 'utf8')) as PriorsConfig;
  return _priorsConfig;
}

/**
 * P1 stub : toutes les causes de l'arbre (signature→sous-arbre en P2/P3).
 */
export function deriveCandidates(
  _family: 'pac_air_eau',
  _code?: string | null,
): string[] {
  return getAllCauses().map((c) => c.cause_id);
}

export function initialHypothesesV3(
  family: 'pac_air_eau',
  code?: string | null,
): HypothesisState[] {
  const cfg = loadPriorsConfig();
  const candidateIds = deriveCandidates(family, code);
  const alphas = candidateIds.map((id) => cfg.dirichlet_alpha[id] ?? 1);
  const sumAlpha = alphas.reduce((s, a) => s + a, 0);

  const rows: HypothesisState[] = candidateIds.map((id) => {
    const alpha = cfg.dirichlet_alpha[id] ?? 1;
    let prior = alpha / sumAlpha;
    if (id === RESIDUAL_CAUSE_ID) {
      prior = cfg.residual_prior;
    }
    const label =
      (CANONICAL_LABELS as Record<string, string>)[id] ?? id;
    return { id, label, prior, n_observations: 0 };
  });

  const concludable = rows.filter((r) => r.id !== RESIDUAL_CAUSE_ID);
  const residual = rows.find((r) => r.id === RESIDUAL_CAUSE_ID);
  const residualPrior = residual?.prior ?? cfg.residual_prior;
  const share = (1 - residualPrior) / concludable.length;

  const normalized = concludable.map((r) => ({ ...r, prior: share }));
  if (residual) {
    normalized.push({ ...residual, prior: residualPrior });
  }

  return normalized;
}
