/** Types partagés — moteur d'observation v3. */
import type { LrTier } from './constants.js';

export type Band = 'below' | 'in' | 'above';

export type NumericReading = {
  quantity_id: string;
  value: number;
  unit?: string;
};

export type QualitativeReading = {
  quantity_id: string;
  modality: string;
};

export type Reading = NumericReading | QualitativeReading;

export function isNumericReading(r: Reading): r is NumericReading {
  return 'value' in r && r.value != null;
}

export type ParsedObservation =
  | { kind: 'numeric'; quantity_id: string; band: Band }
  | { kind: 'qualitative'; quantity_id: string; modality: string };

export type OperatingState = 'regime_etabli' | 'en_securite' | 'cycle_court';

export type CaseContext = {
  brand?: string | null;
  model?: string | null;
  equipment_type: string;
  install_age_years?: number | null;
  season?: string | null;
  emitter?: string | null;
  regime_eau?: string | null;
  puissance_kw?: number | null;
  fluide?: string | null;
  target_component?: string | null;
  operating_state?: OperatingState | null;
  in_corpus?: boolean;
};

export type V3Observation = {
  action_id: string;
  reading: Reading;
  resolves?: boolean;
  wrong_part?: boolean;
  observation_text?: string;
};

export type CauseEffect = {
  quantity: string;
  direction?: 'low' | 'high' | 'in_range';
  value?: string;
  lr: LrTier;
  operating_state?: OperatingState;
  status?: 'sourced' | 'draft';
  sources?: string[];
  note?: string;
};

export type CauseDef = {
  cause_id: string;
  mechanism?: string;
  effects: CauseEffect[];
  repair_actions: string[];
};

export type FaultTree = {
  version: string;
  family: string;
  T_cutoff: string;
  lr_tiers: Record<LrTier, number>;
  post_repair_rules: {
    confirmatory: { description: string; lr: LrTier };
    counterfactual: { description: string; lr: LrTier };
  };
  causes: CauseDef[];
};

export type QuantityDef = {
  quantity_id: string;
  unit: string | null;
  action_id?: string;
  kind: 'numeric' | 'qualitative';
  nominal?: Record<string, [number, number]>;
  condition_var?: string | null;
  modalities?: string[];
  sources?: string[];
};

export type QuantitiesFile = {
  version: string;
  family: string;
  T_cutoff: string;
  quantities: QuantityDef[];
};

export type ActionQuantityMap = {
  version: string;
  taxonomy_version: string;
  mes: Record<string, { quantities: string[]; kind: string; composite?: boolean }>;
  obs: Record<string, { quantity: string; kind: string }>;
};

export type V3Case = {
  id: string;
  version: 3;
  split: string;
  locale: string;
  symptom: {
    narrative: string;
    code_present?: string | null;
    code_absent_by_design?: boolean;
  };
  context: CaseContext;
  initial_readings?: Record<string, Reading>;
  observations: V3Observation[];
  ground_truth: { cause_id: string };
  expert_path: string[];
  meta: { family?: string; tags?: string[]; created_at?: string; author?: string };
};

export type SessionStateV3 = {
  hypotheses: Array<{ id: string; label: string; prior: number }>;
  context: CaseContext;
  executed: Set<string>;
  code?: string | null;
};
