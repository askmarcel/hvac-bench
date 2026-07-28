import type { V2Case, V2RunRecord } from './types.js';

const INVASIVE_PREFIXES = new Set(['REM', 'INT']);

function actionPrefix(actionId: string): string {
  return actionId.split('-')[0] ?? '';
}

function isInvasive(actionId: string): boolean {
  return INVASIVE_PREFIXES.has(actionPrefix(actionId));
}

function expertFirstLessInvasive(c: V2Case, firstAction: string | undefined): boolean {
  if (!firstAction || !c.expert_path.length) return false;
  const expertFirst = c.expert_path[0]!;
  if (!isInvasive(firstAction)) return false;
  if (isInvasive(expertFirst)) return false;
  return true;
}

/** P(1re action exécutée ∈ expert_path). */
export function expertPathFirstHit(c: V2Case, r: V2RunRecord): boolean {
  const first = r.path[0];
  if (!first) return false;
  return c.expert_path.includes(first);
}

/** Première action invasive alors qu'une action moins invasive ouvrait expert_path. */
export function invasiveWrongFirst(c: V2Case, r: V2RunRecord): boolean {
  return expertFirstLessInvasive(c, r.path[0]);
}

/** wrong_part exécuté OU première action invasive hors expert_path. */
export function wrongPartHit(c: V2Case, r: V2RunRecord): boolean {
  for (const aid of r.path) {
    const t = c.tests.find((x) => x.action_id === aid);
    if (t?.wrong_part) return true;
  }
  const first = r.path[0];
  if (first && isInvasive(first) && !c.expert_path.includes(first)) {
    return true;
  }
  return false;
}

export function aggregateOracleMetrics(
  cases: V2Case[],
  records: V2RunRecord[],
): {
  expert_path_first_hit_rate: number;
  invasive_wrong_first_rate: number;
  wrong_part_rate: number;
} {
  const caseMap = new Map(cases.map((c) => [c.id, c]));
  let expertHit = 0;
  let invasiveWrong = 0;
  let wrongPart = 0;
  let n = 0;

  for (const r of records) {
    const c = caseMap.get(r.case_id);
    if (!c) continue;
    n++;
    if (expertPathFirstHit(c, r)) expertHit++;
    if (invasiveWrongFirst(c, r)) invasiveWrong++;
    if (wrongPartHit(c, r)) wrongPart++;
  }

  return {
    expert_path_first_hit_rate: n ? expertHit / n : 0,
    invasive_wrong_first_rate: n ? invasiveWrong / n : 0,
    wrong_part_rate: n ? wrongPart / n : 0,
  };
}
