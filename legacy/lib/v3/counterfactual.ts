/**
 * Règles contrefactuelles post-réparation (MAN-* / REM-*).
 */
import { getAllCauses, getPostRepairLr } from './knowledge-loader.js';
import { readObservation } from './read-observation.js';
import type { CaseContext, V3Observation } from './types.js';

export function causesTargetedByRepairAction(actionId: string): string[] {
  return getAllCauses()
    .filter((c) => c.repair_actions.includes(actionId))
    .map((c) => c.cause_id);
}

export function isRepairAction(actionId: string): boolean {
  return actionId.startsWith('MAN-') || actionId.startsWith('REM-');
}

export type CounterfactualOverlay = Map<string, number>;

/**
 * Facteurs additionnels après mise à jour LR standard.
 * Retourne cause_id → facteur (LR fort ou 1/LR fort).
 */
export function counterfactualOverlay(
  observation: V3Observation,
  context: CaseContext,
): CounterfactualOverlay {
  const overlay = new Map<string, number>();
  const { action_id, reading, resolves, wrong_part } = observation;

  if (!isRepairAction(action_id)) return overlay;

  const lr = getPostRepairLr('confirmatory');
  const invLr = 1 / lr;

  const parsed = readObservation(reading, context);
  const inNominal =
    parsed.kind === 'numeric' ? parsed.band === 'in' : false;

  const targeted = causesTargetedByRepairAction(action_id);

  if (wrong_part) {
    for (const causeId of targeted) {
      overlay.set(causeId, invLr);
    }
    return overlay;
  }

  for (const causeId of targeted) {
    if (resolves === true && inNominal) {
      overlay.set(causeId, lr);
    } else if (resolves !== true && inNominal) {
      overlay.set(causeId, invLr);
    } else if (resolves === true && !inNominal) {
      overlay.set(causeId, invLr);
    }
  }

  return overlay;
}
