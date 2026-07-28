/**
 * Lecture d'observation → bande numérique ou modalité qualitative.
 *
 * Pseudo-modalités sur grandeurs numériques (cas pilote v3) :
 *   low → below, high → above, normal|in_range → in
 */
import {
  getNominalRange,
  getQuantity,
  valueToBand,
} from './knowledge-loader.js';
import type { Band, CaseContext, ParsedObservation, Reading } from './types.js';

const PSEUDO_NUMERIC_MODALITY: Record<string, Band> = {
  low: 'below',
  high: 'above',
  normal: 'in',
  in_range: 'in',
};

export function readObservation(reading: Reading, context: CaseContext): ParsedObservation {
  const q = getQuantity(reading.quantity_id);
  if (!q) {
    throw new Error(`Unknown quantity: ${reading.quantity_id}`);
  }

  if (q.kind === 'qualitative' || 'modality' in reading) {
    const modality = (reading as { modality: string }).modality;
    const pseudo = PSEUDO_NUMERIC_MODALITY[modality];
    if (pseudo && q.kind === 'numeric') {
      return { kind: 'numeric', quantity_id: reading.quantity_id, band: pseudo };
    }
    return { kind: 'qualitative', quantity_id: reading.quantity_id, modality };
  }

  const value = (reading as { value: number }).value;
  const range = getNominalRange(reading.quantity_id, context);
  if (!range) {
    return { kind: 'numeric', quantity_id: reading.quantity_id, band: 'in' };
  }
  return {
    kind: 'numeric',
    quantity_id: reading.quantity_id,
    band: valueToBand(value, range),
  };
}

export function isBandConcordant(
  direction: 'low' | 'high' | 'in_range',
  band: Band,
): boolean {
  if (direction === 'low') return band === 'below';
  if (direction === 'high') return band === 'above';
  return band === 'in';
}
