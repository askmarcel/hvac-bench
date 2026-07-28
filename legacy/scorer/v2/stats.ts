import type { V2Case, V2RunRecord } from './types.js';

/** Wilson score interval (95 %). */
export function wilsonCI(successes: number, n: number, z = 1.96): { low: number; high: number } | null {
  if (n <= 0) return null;
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const center = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
  return {
    low: Math.max(0, (center - margin) / denom),
    high: Math.min(1, (center + margin) / denom),
  };
}

/** Entropie Shannon (bits) sur distribution discrète. */
export function entropyBits(counts: Map<string, number>): number {
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  let h = 0;
  for (const c of counts.values()) {
    if (c <= 0) continue;
    const p = c / total;
    h -= p * Math.log2(p);
  }
  return h;
}

/** Information mutuelle I(X;Y) en bits (estimateur plug-in). */
export function mutualInformation(
  pairs: Array<{ x: string; y: string }>,
): number {
  const n = pairs.length;
  if (n === 0) return 0;
  const px = new Map<string, number>();
  const py = new Map<string, number>();
  const pxy = new Map<string, number>();
  for (const { x, y } of pairs) {
    px.set(x, (px.get(x) ?? 0) + 1);
    py.set(y, (py.get(y) ?? 0) + 1);
    const k = `${x}\0${y}`;
    pxy.set(k, (pxy.get(k) ?? 0) + 1);
  }
  let mi = 0;
  for (const [k, cxy] of pxy) {
    const [x, y] = k.split('\0');
    const p = cxy / n;
    const pxv = (px.get(x!) ?? 0) / n;
    const pyv = (py.get(y!) ?? 0) / n;
    if (p > 0 && pxv > 0 && pyv > 0) mi += p * Math.log2(p / (pxv * pyv));
  }
  return mi;
}

export type CaseAggregate = {
  case_id: string;
  arm: string;
  pass3: boolean;
  majority: boolean;
  any_success: boolean;
};

export function isCaseSuccess(c: V2Case | undefined, r: V2RunRecord): boolean {
  if (c?.meta.family === 'escalade_legitime') {
    return r.final_output.state === 'escalation' && Boolean(c.escalation_expected);
  }
  return r.concluded && r.cause_id === r.true_cause_id;
}

/** pass^3 : tous les réplicats réussissent (convergence ou escalade légitime). */
export function aggregateByCase(
  records: V2RunRecord[],
  arm: string,
  cases?: V2Case[],
): CaseAggregate[] {
  const caseMap = new Map(cases?.map((c) => [c.id, c]));
  const byCase = new Map<string, V2RunRecord[]>();
  for (const r of records.filter((x) => x.arm === arm)) {
    const list = byCase.get(r.case_id) ?? [];
    list.push(r);
    byCase.set(r.case_id, list);
  }
  const out: CaseAggregate[] = [];
  for (const [case_id, recs] of byCase) {
    const ok = (r: V2RunRecord) => isCaseSuccess(caseMap.get(r.case_id), r);
    const successes = recs.filter(ok).length;
    out.push({
      case_id,
      arm,
      pass3: recs.length > 0 && recs.every(ok),
      majority: successes > recs.length / 2,
      any_success: successes > 0,
    });
  }
  return out.sort((a, b) => a.case_id.localeCompare(b.case_id));
}

export function pass3Rate(aggregates: CaseAggregate[]): number {
  if (!aggregates.length) return 0;
  return aggregates.filter((a) => a.pass3).length / aggregates.length;
}

export function firstActions(records: V2RunRecord[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of records) {
    const first = r.path[0] ?? '__empty__';
    counts.set(first, (counts.get(first) ?? 0) + 1);
  }
  return counts;
}

export function distinctPathRatio(records: V2RunRecord[]): number {
  const caseIds = new Set(records.map((r) => r.case_id));
  const nCases = caseIds.size || 1;
  const paths = new Set(records.map((r) => r.path.join('→')));
  return paths.size / nCases;
}
