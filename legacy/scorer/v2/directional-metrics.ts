/**
 * Métriques directionnelles — Δ log-odds et trajectoire du rang (audit S3).
 */
import type { V2Case, V2RunRecord } from './types.js';

const P_FLOOR = 1e-4;
const LOG_ODDS_CAP = 3;

export function logOdds(p: number): number {
  const clamped = Math.min(Math.max(p, P_FLOOR), 1 - P_FLOOR);
  return Math.log(clamped / (1 - clamped));
}

export function deltaLogOdds(before: number, after: number): number {
  const delta = logOdds(after) - logOdds(before);
  return Math.max(-LOG_ODDS_CAP, Math.min(LOG_ODDS_CAP, delta));
}

export function rankOf(hypotheses: Array<{ id: string; prior: number }>, causeId: string): number {
  const sorted = [...hypotheses].sort((a, b) => b.prior - a.prior);
  const idx = sorted.findIndex((h) => h.id === causeId);
  return idx < 0 ? sorted.length : idx + 1;
}

export function computeDirectionalMetrics(
  cases: V2Case[],
  records: V2RunRecord[],
): {
  median_delta_log_odds: number | null;
  mean_true_cause_rank_final: number | null;
  n_diagnosable: number;
} {
  const caseMap = new Map(cases.map((c) => [c.id, c]));
  const deltas: number[] = [];
  const ranks: number[] = [];

  for (const r of records) {
    const c = caseMap.get(r.case_id);
    if (!c || c.meta.family === 'escalade_legitime') continue;

    const trueId = c.hypotheses.find((h) => h.true_cause)?.id;
    if (!trueId) continue;

    const initial = c.hypotheses.find((h) => h.id === trueId)?.prior ?? 1 / c.hypotheses.length;
    const finalRanked =
      r.hypotheses_final ??
      (r.final_output.hypotheses_ranked as Array<{ id: string; prior: number }> | undefined);
    const finalPrior =
      finalRanked?.find((h) => h.id === trueId)?.prior ??
      (r.cause_id === trueId ? 0.9 : initial);

    deltas.push(deltaLogOdds(initial, finalPrior));
    if (finalRanked?.length) ranks.push(rankOf(finalRanked, trueId));
  }

  const median =
    deltas.length > 0
      ? [...deltas].sort((a, b) => a - b)[Math.floor(deltas.length / 2)]!
      : null;
  const meanRank = ranks.length ? ranks.reduce((a, b) => a + b, 0) / ranks.length : null;

  return {
    median_delta_log_odds: median,
    mean_true_cause_rank_final: meanRank,
    n_diagnosable: deltas.length,
  };
}
