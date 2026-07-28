/**
 * Matrice hypothèse → actions — source unique alignée prod (canonical) / bench / Supabase.
 */
import {
  CANONICAL_HYPOTHESIS_IDS,
  HYPOTHESIS_ACTIONS,
} from '../../AskMarcel-WebApp-NextJS/lib/diagnostic-v2/canonical-hypotheses.ts';

export { CANONICAL_HYPOTHESIS_IDS, HYPOTHESIS_ACTIONS };

export function getHypothesisActionsRecord(): Record<string, string[]> {
  return HYPOTHESIS_ACTIONS;
}

export function hypothesisActionsMap(hypothesisIds: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const hid of hypothesisIds) {
    map.set(hid, [...(HYPOTHESIS_ACTIONS[hid] ?? [])]);
  }
  return map;
}

export type ActionDiscriminatingPower = {
  action_id: string;
  n_hypotheses: number;
  hypothesis_ids: string[];
};

/** Combien de causes chaque action distingue (diagnostic structurel — pas objectif d'enrichissement). */
export function measureActionDiscriminatingPower(
  matrix: Record<string, string[]> = HYPOTHESIS_ACTIONS,
): ActionDiscriminatingPower[] {
  const inverse = new Map<string, Set<string>>();
  for (const [hid, actions] of Object.entries(matrix)) {
    for (const aid of actions) {
      let set = inverse.get(aid);
      if (!set) {
        set = new Set();
        inverse.set(aid, set);
      }
      set.add(hid);
    }
  }
  return [...inverse.entries()]
    .map(([action_id, set]) => ({
      action_id,
      n_hypotheses: set.size,
      hypothesis_ids: [...set].sort(),
    }))
    .sort((a, b) => b.n_hypotheses - a.n_hypotheses || a.action_id.localeCompare(b.action_id));
}

export function specificitySummary(matrix: Record<string, string[]> = HYPOTHESIS_ACTIONS) {
  const powers = measureActionDiscriminatingPower(matrix);
  const nActions = powers.length;
  const overBroadCount = powers.filter((p) => p.n_hypotheses > 3);
  const median =
    nActions === 0
      ? 0
      : powers[Math.floor(nActions / 2)]!.n_hypotheses;
  return {
    n_actions_linked: nActions,
    n_hypotheses: Object.keys(matrix).length,
    median_hypotheses_per_action: median,
    /** @deprecated Compte brut — préférer EIG et masse a priori (voi-eig-analysis). */
    in_band_1_to_3: powers.filter((p) => p.n_hypotheses >= 1 && p.n_hypotheses <= 3).length,
    over_broad_gt_3: overBroadCount.length,
    over_broad_actions: overBroadCount,
    powers,
  };
}

export function matricesEqual(
  a: Record<string, string[]>,
  b: Record<string, string[]>,
): string[] {
  const diffs: string[] = [];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of [...keys].sort()) {
    const aa = [...(a[k] ?? [])].sort();
    const bb = [...(b[k] ?? [])].sort();
    if (aa.length !== bb.length || aa.some((v, i) => v !== bb[i])) {
      diffs.push(k);
    }
  }
  return diffs;
}

export function normalizeMatrixForSnapshot(
  matrix: Record<string, string[]>,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const id of CANONICAL_HYPOTHESIS_IDS) {
    out[id] = [...(matrix[id] ?? [])].sort();
  }
  return out;
}
