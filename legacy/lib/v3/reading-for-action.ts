/**
 * Sélection reading v3 alignée sur action-quantity-map.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseObservationText } from './readings-parser.js';

export type ReadingOut = {
  quantity_id: string;
  value?: number;
  unit?: string;
  modality?: string;
};

const ACTION_MAP = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../taxonomy/action-quantity-map-v3.json'), 'utf8'),
) as {
  mes: Record<string, { quantities: string[] }>;
  obs: Record<string, { quantity: string }>;
};

const ACTION_DEFAULT_NUMERIC: Record<string, { quantity_id: string; value: number; unit: string }> = {
  'MES-DT-EAU': { quantity_id: 'delta_t_eau', value: 4, unit: 'K' },
  'MES-PRESSION': { quantity_id: 'pression_circuit_bar', value: 1.2, unit: 'bar' },
  'MES-DEBIT': { quantity_id: 'debit_l_min', value: 18, unit: 'l/min' },
  'MES-HP-BP': { quantity_id: 'hp_bar', value: 12, unit: 'bar' },
  'MES-SONDE': { quantity_id: 'delta_sonde_k', value: 3, unit: 'K' },
  'MES-CONTINUITE': { quantity_id: 'continuite_sonde_ohm', value: 0, unit: 'ohm' },
  'MES-RESISTANCE': { quantity_id: 'resistance_ohm', value: 1000, unit: 'ohm' },
  'MES-TEMP-AMBIANTE': { quantity_id: 't_depart', value: 35, unit: '°C' },
  'MES-AMPERAGE': { quantity_id: 'amperage_circulateur', value: 0.8, unit: 'A' },
};

const ACTION_DEFAULT_QUAL: Record<string, { quantity_id: string; modality: string }> = {
  'OBS-PURGEUR': { quantity_id: 'purgeur', modality: 'crache_air' },
  'OBS-BRUIT-POMPE': { quantity_id: 'bruit_pompe', modality: 'claquement' },
  'OBS-GELEE': { quantity_id: 'givre', modality: 'localise' },
  'OBS-LED-DEFAUT': { quantity_id: 'led_defaut', modality: 'code' },
  'OBS-VANNE': { quantity_id: 'vanne_position', modality: 'fermee' },
  'OBS-BYPASS': { quantity_id: 'bypass_ouvert', modality: 'non' },
  'OBS-FUITE': { quantity_id: 'fuite_visible', modality: 'absent' },
  'OBS-CONDENSATS': { quantity_id: 'condensats', modality: 'bouche' },
};

function allowedQuantities(actionId: string): string[] | null {
  const mes = ACTION_MAP.mes[actionId];
  if (mes) return mes.quantities;
  const obs = ACTION_MAP.obs[actionId];
  if (obs) return [obs.quantity];
  return null;
}

function formatReading(r: {
  quantity_id: string;
  value?: number;
  unit?: string;
  modality?: string;
  status: string;
}): ReadingOut {
  if (r.status === 'parsed' && r.value != null) {
    return { quantity_id: r.quantity_id, value: r.value, unit: r.unit };
  }
  return { quantity_id: r.quantity_id, modality: r.modality };
}

export function defaultReadingForAction(
  actionId: string,
  opts?: { resolves?: boolean },
): ReadingOut {
  const num = ACTION_DEFAULT_NUMERIC[actionId];
  if (num) return { quantity_id: num.quantity_id, value: num.value, unit: num.unit };
  const qual = ACTION_DEFAULT_QUAL[actionId];
  if (qual) return qual;
  if (actionId === 'MAN-PURGE' && opts?.resolves) {
    return { quantity_id: 'delta_t_eau', value: 6.2, unit: 'K' };
  }
  if (actionId === 'MAN-REMPLISSAGE' && opts?.resolves) {
    return { quantity_id: 'pression_circuit_bar', value: 1.5, unit: 'bar' };
  }
  if (actionId === 'MAN-REGLAGE-BYPASS') {
    return { quantity_id: 'bypass_ouvert', modality: 'oui' };
  }
  if (actionId.startsWith('REM-')) {
    return { quantity_id: 'debit_l_min', value: 22, unit: 'l/min' };
  }
  return { quantity_id: 'pression_circuit_bar', value: 1.5, unit: 'bar' };
}

export function readingForActionText(
  actionId: string,
  observationText: string,
  opts?: { resolves?: boolean },
): ReadingOut {
  const parsed = parseObservationText(observationText, actionId);
  const allowed = allowedQuantities(actionId);
  if (allowed) {
    const match = parsed.readings.find((r) => allowed.includes(r.quantity_id));
    if (match) return formatReading(match);
    return defaultReadingForAction(actionId, opts);
  }
  if (parsed.readings.length > 0) return formatReading(parsed.readings[0]!);
  return defaultReadingForAction(actionId, opts);
}

export function toObservationReading(reading: ReadingOut): Record<string, unknown> {
  if (reading.value != null) {
    return { quantity_id: reading.quantity_id, value: reading.value, unit: reading.unit };
  }
  return { quantity_id: reading.quantity_id, modality: reading.modality };
}
