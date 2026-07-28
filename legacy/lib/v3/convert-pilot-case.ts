/**
 * Convertit un cas pilote v2 → v3 (observations structurées).
 */
import { parseObservationText } from './readings-parser.js';
import {
  defaultReadingForAction,
  readingForActionText,
  type ReadingOut,
} from './reading-for-action.js';

type V2Test = {
  action_id: string;
  observation: string;
  resolves?: boolean;
  wrong_part?: boolean;
};

type V2Case = {
  id: string;
  split: string;
  locale: string;
  symptom: { narrative: string; code_present: string | null; code_absent_by_design: boolean };
  context: Record<string, unknown>;
  initial_readings?: Record<string, number | string | null>;
  tests: V2Test[];
  expert_path: string[];
  expert_path_cost_eur?: number;
  expert_path_minutes?: number;
  forbidden_before?: Record<string, string[]>;
  escalation_expected?: unknown;
  flags?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  hypotheses: Array<{ id: string; true_cause?: boolean }>;
};

function readingForAction(t: V2Test): ReadingOut {
  return readingForActionText(t.action_id, t.observation, { resolves: t.resolves });
}

function patchHb20001(caseV3: ReturnType<typeof buildCase>) {
  if (caseV3.id !== 'hb2-0001') return caseV3;
  return {
    ...caseV3,
    context: { ...caseV3.context, emitter: 'plancher_chauffant', regime_eau: 'chauffage' },
    initial_readings: {
      pression_circuit_bar: { quantity_id: 'pression_circuit_bar', value: 1.2, unit: 'bar' },
    },
    observations: caseV3.observations.map((o) => {
      if (o.action_id === 'MAN-PURGE') {
        return {
          ...o,
          resolves: true,
          reading: { quantity_id: 'delta_t_eau', value: 6.2, unit: 'K' },
        };
      }
      if (o.action_id === 'OBS-PURGEUR') {
        return { ...o, reading: { quantity_id: 'purgeur', modality: 'crache_air' } };
      }
      return o;
    }),
  };
}

function patchHb20005(caseV3: ReturnType<typeof buildCase>) {
  if (caseV3.id !== 'hb2-0005') return caseV3;
  return {
    ...caseV3,
    observations: caseV3.observations.map((o) => {
      if (o.action_id === 'MAN-REMPLISSAGE') {
        return {
          ...o,
          resolves: true,
          reading: { quantity_id: 'pression_circuit_bar', value: 1.5, unit: 'bar' },
        };
      }
      if (o.action_id === 'REM-FLOWSWITCH') {
        return {
          ...o,
          wrong_part: true,
          reading: { quantity_id: 'debit_l_min', value: 22, unit: 'l/min' },
        };
      }
      if (o.action_id === 'MAN-PURGE') {
        return {
          ...o,
          reading: { quantity_id: 'pression_circuit_bar', value: 1.5, unit: 'bar' },
        };
      }
      return o;
    }),
  };
}

function buildCase(v2: V2Case) {
  const trueCause = v2.hypotheses.find((h) => h.true_cause)?.id ?? 'cause_inconnue';

  const observations = v2.tests.map((t) => {
    const reading = readingForAction(t);
    return {
      action_id: t.action_id,
      reading:
        reading.value != null
          ? { quantity_id: reading.quantity_id, value: reading.value, unit: reading.unit }
          : { quantity_id: reading.quantity_id, modality: reading.modality },
      ...(t.resolves ? { resolves: true } : {}),
      ...(t.wrong_part ? { wrong_part: true } : {}),
      observation_text: t.observation,
    };
  });

  const initial_readings: Record<string, unknown> = {};
  if (v2.initial_readings?.pression_bar != null) {
    initial_readings.pression_circuit_bar = {
      quantity_id: 'pression_circuit_bar',
      value: Number(v2.initial_readings.pression_bar),
      unit: 'bar',
    };
  }

  return {
    id: v2.id,
    version: 3 as const,
    split: v2.split,
    locale: v2.locale,
    symptom: v2.symptom,
    context: { ...v2.context, equipment_type: 'pac_air_eau' },
    ...(Object.keys(initial_readings).length ? { initial_readings } : {}),
    observations,
    ground_truth: { cause_id: trueCause },
    expert_path: v2.expert_path,
    expert_path_cost_eur: v2.expert_path_cost_eur ?? 0,
    expert_path_minutes: v2.expert_path_minutes ?? 0,
    forbidden_before: v2.forbidden_before ?? {},
    escalation_expected: v2.escalation_expected ?? null,
    harvest: {
      source_type: 'pilot_rewrite',
      reformulated: true,
      harvest_date: '2026-07-27',
    },
    flags: v2.flags ?? {},
    meta: v2.meta ?? { created_at: '2026-07-27T00:00:00Z', author: 'agent', family: 'pilot_v3_rewrite' },
  };
}

export function convertPilotCaseToV3(v2: V2Case) {
  let out = buildCase(v2);
  out = patchHb20001(out);
  out = patchHb20005(out);
  return out;
}

// re-export for tests
export { parseObservationText, defaultReadingForAction };
