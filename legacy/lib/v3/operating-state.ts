/**
 * État de fonctionnement — conditionne les directions d'effet sur l'arbre.
 */
import type { CaseContext } from './types.js';

export type OperatingState = 'regime_etabli' | 'en_securite' | 'cycle_court';

/** Codes défaut affichés → PAC en sécurité / cycle court (ΔT bas, pas haut). */
const SECURITY_FAULT_CODES = new Set([
  '7H',
  '7h',
  'E7',
  'A5',
  'U0',
  'F.75',
  'F75',
  'ALM-HP',
]);

export function inferOperatingState(symptom: {
  code_present?: string | null;
}): OperatingState {
  const code = symptom.code_present?.trim();
  if (!code) return 'regime_etabli';
  if (SECURITY_FAULT_CODES.has(code) || SECURITY_FAULT_CODES.has(code.toUpperCase())) {
    return 'en_securite';
  }
  return 'regime_etabli';
}

export function enrichCaseContext(
  context: CaseContext,
  symptom: { code_present?: string | null },
): CaseContext {
  return {
    ...context,
    operating_state: context.operating_state ?? inferOperatingState(symptom),
  };
}
