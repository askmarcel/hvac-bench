/**
 * Matrice action→causes dérivée de l'arbre de défauts v3.
 */
import {
  getActionMap,
  getActionsForQuantity,
  getAllCauses,
} from './knowledge-loader.js';

export function buildHypothesisActionsMap(
  causeIds: string[],
): Map<string, string[]> {
  const map = new Map<string, string[]>();

  for (const causeId of causeIds) {
    const actions = new Set<string>();
    const cause = getAllCauses().find((c) => c.cause_id === causeId);
    if (!cause) {
      map.set(causeId, []);
      continue;
    }
    for (const ra of cause.repair_actions) actions.add(ra);
    for (const effect of cause.effects) {
      for (const aid of getActionsForQuantity(effect.quantity)) {
        actions.add(aid);
      }
    }
    map.set(causeId, [...actions].sort());
  }

  return map;
}

export function buildActionToCausesMap(
  causeIds: string[],
): Map<string, string[]> {
  const ha = buildHypothesisActionsMap(causeIds);
  const inverse = new Map<string, Set<string>>();

  for (const [causeId, actions] of ha) {
    for (const aid of actions) {
      let set = inverse.get(aid);
      if (!set) {
        set = new Set();
        inverse.set(aid, set);
      }
      set.add(causeId);
    }
  }

  const result = new Map<string, string[]>();
  for (const [aid, set] of inverse) {
    result.set(aid, [...set].sort());
  }
  return result;
}

export function diagnosticActionIdsV3(): string[] {
  const map = getActionMap();
  return [...Object.keys(map.mes), ...Object.keys(map.obs)].sort();
}
