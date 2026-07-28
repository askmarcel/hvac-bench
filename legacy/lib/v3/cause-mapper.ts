/**
 * Mappe diagnosis/solution forum → cause canonique v3.
 */
const RULES: Array<{ pattern: RegExp; cause_id: string }> = [
  { pattern: /\b(purge|d[eé]gorg|air dans le circuit|air occlus)\b/i, cause_id: 'air_circuit' },
  { pattern: /\b(filtre|tamis|colmat)\b/i, cause_id: 'filtre_colmate' },
  { pattern: /\b(circulat|pompe).*(gripp|bloqu|d[eé]fect)/i, cause_id: 'pompe_grippee' },
  { pattern: /\b(pression|appoint|remplissage|1[.,]?\d?\s*bar)\b/i, cause_id: 'pression_basse' },
  { pattern: /\b(bypass|soupape diff)/i, cause_id: 'bypass_ferme' },
  { pattern: /\b(flowswitch|débitmètre|contrôleur de débit)\b/i, cause_id: 'flowswitch_hs' },
  { pattern: /\b(sonde|capteur temp)/i, cause_id: 'sonde_hs' },
  { pattern: /\b(carte|pcb|électronique)\b/i, cause_id: 'carte_hs' },
  { pattern: /\b(compresseur)\b/i, cause_id: 'compresseur_hs' },
  { pattern: /\b(dégivrage|givre|degiv)\b/i, cause_id: 'degivrage_anormal' },
  { pattern: /\b(charge|fluide|frigorig|recharge)\b/i, cause_id: 'charge_insuffisante' },
  { pattern: /\b(vanne)\b/i, cause_id: 'vanne_fermee' },
  { pattern: /\b(condensat|siphon)\b/i, cause_id: 'condensats_bouches' },
  { pattern: /\b(débit|debit).*(insuffis|faible|réduit)/i, cause_id: 'defaut_debit' },
  { pattern: /\b(sous.?dim|dimensionn)/i, cause_id: 'sous_dimension' },
  { pattern: /\b(reset|réinitial|transitoire|paramètre|hysteresis|bande proportionnelle)\b/i, cause_id: 'defaut_transitoire' },
  { pattern: /\b(thermostat|température|cycle court|intermittence)\b/i, cause_id: 'sonde_hs' },
  { pattern: /\b(grésillement|module extérieur|consommation)\b/i, cause_id: 'defaut_transitoire' },
  { pattern: /\b(erreu?r|code|A6|7H|E7)\b/i, cause_id: 'carte_hs' },
  { pattern: /\b(givre|gel)\b/i, cause_id: 'degivrage_anormal' },
];

export function mapTextToCanonicalCause(text: string): string | null {
  const normalized = text.trim();
  if (!normalized) return null;
  for (const rule of RULES) {
    if (rule.pattern.test(normalized)) return rule.cause_id;
  }
  return null;
}

export function inferCauseFromRow(parts: {
  symptom?: string;
  diagnosis?: string;
  solution?: string;
  context?: string;
}): string | null {
  const blob = [parts.symptom, parts.diagnosis, parts.solution, parts.context].filter(Boolean).join(' ');
  return mapTextToCanonicalCause(blob);
}
