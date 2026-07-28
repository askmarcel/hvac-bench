/**
 * Invariant §8 — le sélecteur VOI (bras D) doit concentrer le posterior mieux que le hasard (bras R).
 *
 * max_top_prior(D) > max_top_prior(R) sur les cas diagnostiques pilote.
 * Si R ≥ D, le VOI reste bloqué sur OBS-* alors que le hasard atteint MES-/MAN-.
 */
import { runCaseDLocal, runCaseRLocal } from './prod-session-local.js';
import type { PilotCaseExtended } from '../runners/v2-harness.js';

export type SelectorEvidenceMetrics = {
  n_diagnosable: number;
  max_top_prior_D: number;
  max_top_prior_R: number;
  per_case: Array<{
    case_id: string;
    max_top_prior_D: number;
    max_top_prior_R: number;
    delta_D_minus_R: number;
  }>;
  invariant_holds: boolean;
};

function maxTopPrior(
  record: ReturnType<typeof runCaseDLocal>,
): number {
  const sorted = [...(record.hypotheses_final ?? [])].sort((a, b) => b.prior - a.prior);
  return sorted[0]?.prior ?? 0;
}

export function measureSelectorEvidenceInvariant(
  cases: PilotCaseExtended[],
): SelectorEvidenceMetrics {
  const per_case = cases.map((c) => {
    const dPrior = maxTopPrior(runCaseDLocal(c, 0));
    const rPrior = maxTopPrior(runCaseRLocal(c, 0));
    return {
      case_id: c.id,
      max_top_prior_D: dPrior,
      max_top_prior_R: rPrior,
      delta_D_minus_R: dPrior - rPrior,
    };
  });

  const max_top_prior_D = Math.max(...per_case.map((p) => p.max_top_prior_D), 0);
  const max_top_prior_R = Math.max(...per_case.map((p) => p.max_top_prior_R), 0);

  return {
    n_diagnosable: cases.length,
    max_top_prior_D,
    max_top_prior_R,
    per_case,
    invariant_holds: max_top_prior_D > max_top_prior_R,
  };
}
