/** Constantes partagées Phase 0 — primitive observation v3. */
export const T_CUTOFF = '2026-04-01';
export const KNOWLEDGE_AUTHORED_AT = '2026-07-27';
export const TAXONOMY_VERSION = 'quantities-v3.2026-07-27';
export const FAULT_TREE_VERSION = 'fault-tree-v3-pac_air_eau.2026-07-27';
export const SCHEMA_V3_VERSION = 3;

import type { OperatingState } from './types.js';

export const LR_VALUES = { fort: 10, moyen: 3, faible: 1.5 } as const;
export type LrTier = keyof typeof LR_VALUES;

/** Résolution ciblant C avec symptôme disparu — quasi-preuve (équivalent v2 eliminate⁻¹). */
export const CONFIRMATORY_RESOLVES_LR = 100;

export const TOP8_CAUSES = [
  'air_circuit',
  'pompe_grippee',
  'pression_basse',
  'filtre_colmate',
  'flowswitch_hs',
  'vanne_fermee',
  'sonde_hs',
  'bypass_ferme',
] as const;

export const PICK_ESCALATE = 'escalate' as const;
export type PickNextActionResult = string | typeof PICK_ESCALATE | null;
