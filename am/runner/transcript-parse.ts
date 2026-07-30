/**
 * Extraction indépendante depuis le texte technicien / réponses installateur.
 * Patterns accent-free, triés par spécificité (HP/BP avant pression circuit).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { PlageAnnoncee, Reading } from '../scorer/mechanical.js';

const AM_ROOT = resolve(import.meta.dirname, '..');
const HVAC_BENCH_ROOT = resolve(AM_ROOT, '..');

type QuantityEntry = {
  quantity_id: string;
  unit: string | null;
  action_id: string;
  kind: 'numeric' | 'qualitative';
};

type ActionEntry = {
  action_id: string;
  label: string;
};

type QuantityPatternDef = {
  quantity_id: string;
  /** Plus élevé = gagne en cas de collision (HP/BP avant pression circuit). */
  specificity: number;
  /** Sous-chaînes accent-free, testées sur texte normalisé. */
  patterns: string[];
  /** Si vrai sur le texte, ce pattern est ignoré. */
  excludeIf?: RegExp;
  /** Phrase naturelle pour le check de couverture exhaustive (O11). */
  coveragePhrase: string;
};

let quantityPatternDefs: QuantityPatternDef[] | null = null;
let actionEntries: ActionEntry[] | null = null;
let actionIdSet: Set<string> | null = null;
let quantityById: Map<string, QuantityEntry> | null = null;

const FRIGO_PRESSURE_CTX = /\b(hp|bp|haute pression|basse pression)\b/;

/** Définitions exhaustives — une entrée par quantity_id de quantities-v3.json. */
const QUANTITY_PATTERN_DEFS: QuantityPatternDef[] = [
  {
    quantity_id: 'hp_bar',
    specificity: 100,
    patterns: ['hp', 'haute pression'],
    coveragePhrase: 'Releve la haute pression HP, attendu 25 a 30 bar',
  },
  {
    quantity_id: 'bp_bar',
    specificity: 100,
    patterns: ['bp', 'basse pression'],
    coveragePhrase: 'Quelle est la basse pression BP en bar ?',
  },
  {
    quantity_id: 'delta_hp_bp',
    specificity: 110,
    patterns: ['delta entre hp et bp', 'delta hp bp', 'ecart hp bp'],
    coveragePhrase: 'Mesure le delta entre HP et BP',
  },
  {
    quantity_id: 'surchauffe_k',
    specificity: 90,
    patterns: ['surchauffe'],
    coveragePhrase: 'Mesure la surchauffe, on attend 5 a 8 K',
  },
  {
    quantity_id: 'sous_refroidissement_k',
    specificity: 90,
    patterns: ['sous refroidissement', 'sous-refroidissement'],
    coveragePhrase: 'Quel est le sous refroidissement ?',
  },
  {
    quantity_id: 'amperage_compresseur',
    specificity: 85,
    patterns: ['amperage compresseur', 'amperage du compresseur', 'intensite compresseur'],
    coveragePhrase: 'Mesure l amperage du compresseur',
  },
  {
    quantity_id: 'amperage_circulateur',
    specificity: 85,
    patterns: ['amperage circulateur', 'amperage du circulateur', 'intensite circulateur'],
    coveragePhrase: 'Mesure l amperage du circulateur',
  },
  {
    quantity_id: 'delta_t_eau',
    specificity: 80,
    patterns: ['delta t', 'ecart de temperature', 'ecart temperature eau', 'delta temperature eau'],
    coveragePhrase: 'Donne le delta T eau depart retour',
  },
  {
    quantity_id: 'debit_l_min',
    specificity: 75,
    patterns: ['debit', 'l/min', 'litres par minute', 'litre par minute'],
    coveragePhrase: 'Quel est le debit en l/min ?',
  },
  {
    quantity_id: 't_depart',
    specificity: 70,
    patterns: ['temperature depart', 'temperature de depart', 'temp depart'],
    coveragePhrase: 'Donne la temperature de depart, entre 35 et 45',
  },
  {
    quantity_id: 't_retour',
    specificity: 70,
    patterns: ['temperature retour', 'temperature de retour', 'temp retour'],
    coveragePhrase: 'Quelle temperature de retour ?',
  },
  {
    quantity_id: 't_exterieure',
    specificity: 65,
    patterns: ['temperature exterieure', 'temp exterieure', 'air exterieur'],
    coveragePhrase: 'Temperature exterieure actuelle ?',
  },
  {
    quantity_id: 'delta_sonde_k',
    specificity: 65,
    patterns: ['ecart sonde', 'ecart entre sonde', 'delta sonde'],
    coveragePhrase: 'Quel ecart entre sonde et mesure locale ?',
  },
  {
    quantity_id: 'continuite_sonde_ohm',
    specificity: 65,
    patterns: ['continuite sonde', 'continuite de la sonde', 'continuite du fil sonde'],
    coveragePhrase: 'Mesure la continuite de la sonde',
  },
  {
    quantity_id: 'resistance_ohm',
    specificity: 65,
    patterns: ['resistance ohm', 'resistance en ohm', 'mesure resistance'],
    coveragePhrase: 'Quelle resistance en ohm ?',
  },
  {
    quantity_id: 'pression_circuit_bar',
    specificity: 40,
    patterns: [
      'pression circuit',
      'pression du circuit',
      'pression hydraulique',
      'pression vase',
      'pression d eau',
      'pression manometre',
      'pression au manometre',
      'pression',
    ],
    excludeIf: FRIGO_PRESSURE_CTX,
    coveragePhrase: 'Verifie la pression du circuit hydraulique, 1,2-2,0 bar',
  },
  {
    quantity_id: 'purgeur',
    specificity: 60,
    patterns: ['purgeur'],
    coveragePhrase: 'Regarde le purgeur automatique',
  },
  {
    quantity_id: 'bruit_pompe',
    specificity: 60,
    patterns: ['bruit pompe', 'bruit de pompe', 'bruit sur la pompe'],
    coveragePhrase: 'Tu entends un bruit sur la pompe ?',
  },
  {
    quantity_id: 'givre',
    specificity: 60,
    patterns: ['givre', 'gelee', 'gel sur'],
    coveragePhrase: 'Y a-t-il du givre sur l echangeur ?',
  },
  {
    quantity_id: 'led_defaut',
    specificity: 55,
    patterns: ['led defaut', 'voyant defaut', 'code defaut affiche'],
    coveragePhrase: 'Le voyant defaut est allume ?',
  },
  {
    quantity_id: 'fuite_visible',
    specificity: 55,
    patterns: ['fuite', 'fuite visible', 'perte d eau'],
    coveragePhrase: 'Tu vois une fuite ?',
  },
  {
    quantity_id: 'vanne_position',
    specificity: 55,
    patterns: ['position vanne', 'vanne ouverte', 'vanne fermee', 'quelle position'],
    coveragePhrase: 'La vanne est en quelle position ?',
  },
  {
    quantity_id: 'bypass_ouvert',
    specificity: 55,
    patterns: ['bypass', 'by-pass'],
    coveragePhrase: 'Le bypass est ouvert ?',
  },
  {
    quantity_id: 'condensats',
    specificity: 55,
    patterns: ['condensats', 'condensat'],
    coveragePhrase: 'Les condensats s evacuent bien ?',
  },
  {
    quantity_id: 'capteur_etat',
    specificity: 30,
    patterns: [
      'etat du capteur',
      'etat capteur',
      'capteur defectueux',
      'connectique capteur',
      'sonde defectueuse',
      'capteur temperature',
    ],
    excludeIf: /\bpression\b/,
    coveragePhrase: 'Etat du capteur de temperature ?',
  },
  {
    quantity_id: 'vapeur_anormale',
    specificity: 55,
    patterns: ['vapeur', 'fumee anormale'],
    coveragePhrase: 'Tu vois de la vapeur anormale ?',
  },
];

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function compileNormPattern(pattern: string): RegExp {
  const norm = normalizeText(pattern);
  const parts = norm
    .split(/\s+/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (parts.length === 1) {
    return new RegExp(`\\b${parts[0]}\\b`, 'i');
  }
  const filler = '(?:\\s+(?:de|du|des|la|le|les|sur|entre|un|une|d|l|et))*';
  const re = parts.join(`${filler}\\s+`);
  return new RegExp(`\\b${re}\\b`, 'i');
}

function loadTaxonomy(): void {
  if (quantityPatternDefs && actionEntries && quantityById && actionIdSet) return;

  const quantitiesFile = JSON.parse(
    readFileSync(resolve(HVAC_BENCH_ROOT, 'taxonomy/quantities-v3.json'), 'utf8'),
  ) as { quantities: QuantityEntry[] };

  quantityById = new Map(quantitiesFile.quantities.map((q) => [q.quantity_id, q]));

  const taxonomyIds = new Set(quantitiesFile.quantities.map((q) => q.quantity_id));
  const missingDefs = [...taxonomyIds].filter(
    (id) => !QUANTITY_PATTERN_DEFS.some((d) => d.quantity_id === id),
  );
  if (missingDefs.length > 0) {
    throw new Error(
      `QUANTITY_PATTERN_DEFS incomplet — manque: ${missingDefs.join(', ')}`,
    );
  }
  const orphanDefs = QUANTITY_PATTERN_DEFS.filter((d) => !taxonomyIds.has(d.quantity_id));
  if (orphanDefs.length > 0) {
    throw new Error(
      `QUANTITY_PATTERN_DEFS fantomes — absents de taxonomy: ${orphanDefs.map((d) => d.quantity_id).join(', ')}`,
    );
  }

  quantityPatternDefs = [...QUANTITY_PATTERN_DEFS].sort(
    (a, b) => b.specificity - a.specificity,
  );

  const actionsFile = JSON.parse(
    readFileSync(resolve(HVAC_BENCH_ROOT, 'taxonomy/actions-v2.json'), 'utf8'),
  ) as { actions: ActionEntry[] };
  actionEntries = actionsFile.actions;
  actionIdSet = new Set(actionEntries.map((a) => a.action_id));
}

function patternMatches(norm: string, def: QuantityPatternDef): boolean {
  if (def.excludeIf?.test(norm)) return false;
  return def.patterns.some((p) => compileNormPattern(p).test(norm));
}

export function inferQuantityIdFromText(text: string): string | undefined {
  loadTaxonomy();
  const norm = normalizeText(text);
  for (const def of quantityPatternDefs!) {
    if (patternMatches(norm, def)) return def.quantity_id;
  }
  return undefined;
}

function parseNumericRange(text: string): [number, number] | null {
  const normalized = text.replace(/\s+/g, ' ');
  const rangeMatch =
    normalized.match(/(\d+(?:[,.]\d+)?)\s*(?:[-–—àa]|a)\s*(\d+(?:[,.]\d+)?)/i) ??
    normalized.match(/entre\s+(\d+(?:[,.]\d+)?)\s+et\s+(\d+(?:[,.]\d+)?)/i);
  if (!rangeMatch) return null;
  const low = Number.parseFloat(rangeMatch[1]!.replace(',', '.'));
  const high = Number.parseFloat(rangeMatch[2]!.replace(',', '.'));
  if (!Number.isFinite(low) || !Number.isFinite(high)) return null;
  return low <= high ? [low, high] : [high, low];
}

export type PlageExtractionResult = {
  plages: PlageAnnoncee[];
  /** Désaccord hint getPlages (PROD) vs inférence texte — log uniquement. */
  hintMismatch?: string;
};

/** Plages annoncées par le technicien (texte), jamais depuis la sortie getPlages. */
export function extractPlagesFromTechnicienText(
  technicienContent: string,
  options?: { quantityHint?: string; condition?: string },
): PlageExtractionResult {
  const range = parseNumericRange(technicienContent);
  if (!range) return { plages: [] };

  const quantity_id = inferQuantityIdFromText(technicienContent);
  if (!quantity_id) return { plages: [] };

  let hintMismatch: string | undefined;
  if (options?.quantityHint && options.quantityHint !== quantity_id) {
    hintMismatch = `getPlages hint=${options.quantityHint} vs texte=${quantity_id}`;
  }

  return {
    plages: [
      {
        quantity_id,
        condition: options?.condition,
        plage_annoncee: range,
      },
    ],
    hintMismatch,
  };
}

function assertValidActionId(actionId: string): void {
  loadTaxonomy();
  if (!actionIdSet!.has(actionId)) {
    throw new Error(`action_id inconnu dans actions-v2.json: ${actionId}`);
  }
}

/** action_id inféré du texte technicien — tous bras, labels taxonomy uniquement. */
export function inferActionIdFromTechnicienText(technicienContent: string): string | undefined {
  loadTaxonomy();
  const norm = normalizeText(technicienContent);

  const quantityId = inferQuantityIdFromText(technicienContent);
  if (quantityId) {
    const fromQuantity = quantityById!.get(quantityId)?.action_id;
    if (fromQuantity) {
      assertValidActionId(fromQuantity);
      return fromQuantity;
    }
  }

  let best: { action_id: string; score: number } | undefined;
  for (const action of actionEntries!) {
    const labelNorm = normalizeText(action.label);
    const tokens = labelNorm.split(/\s+/).filter((t) => t.length > 3);
    if (tokens.length === 0) continue;
    const hits = tokens.filter((t) => norm.includes(t)).length;
    if (hits === 0) continue;
    const score = hits / tokens.length;
    if (!best || score > best.score) best = { action_id: action.action_id, score };
  }

  if (best && best.score >= 0.3) return best.action_id;
  return undefined;
}

function parseNumericFromReply(reply: string): number | null {
  const match = reply.match(/(\d+(?:[,.]\d+)?)/);
  if (!match) return null;
  const n = Number.parseFloat(match[1]!.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function inferInstallerReading(
  technicianMessage: string,
  installerReply: string,
  groundState: Record<string, unknown>,
): Reading | undefined {
  loadTaxonomy();

  const quantityId = inferQuantityIdFromText(technicianMessage);
  if (!quantityId) return undefined;

  const quantity = quantityById!.get(quantityId);
  if (!quantity) return undefined;

  if (quantity.kind === 'qualitative') {
    const gsKey =
      quantityId in groundState
        ? quantityId
        : Object.keys(groundState).find((k) => k === quantityId || k.startsWith(quantityId.split('_')[0]!));
    const gsValue = gsKey ? groundState[gsKey] : undefined;
    if (gsValue == null) return undefined;
    const replyNorm = normalizeText(installerReply);
    const valueStr = normalizeText(String(gsValue)).replace(/_/g, ' ');
    if (
      replyNorm.includes(valueStr) ||
      valueStr.split(' ').some((w) => w.length > 3 && replyNorm.includes(w))
    ) {
      return { quantity_id: quantityId, value: String(gsValue) };
    }
    return undefined;
  }

  const parsed = parseNumericFromReply(installerReply);
  if (parsed != null) {
    return {
      quantity_id: quantityId,
      value: parsed,
      unit: quantity.unit ?? undefined,
    };
  }

  return undefined;
}

export function quantityHintFromSteps(
  steps: Array<{ toolCalls: Array<{ toolName: string; input?: unknown }> }>,
): string | undefined {
  for (const step of steps) {
    for (const call of step.toolCalls) {
      if (call.toolName !== 'getPlages' || !call.input || typeof call.input !== 'object') continue;
      const input = call.input as { quantity?: string; quantityId?: string };
      return input.quantity ?? input.quantityId;
    }
  }
  return undefined;
}

/** O11 — chaque quantity_id taxonomy atteignable par sa phrase de couverture. */
export function verifyQuantityPatternCoverage(): string[] {
  const failures: string[] = [];
  for (const def of QUANTITY_PATTERN_DEFS) {
    const inferred = inferQuantityIdFromText(def.coveragePhrase);
    if (inferred !== def.quantity_id) {
      failures.push(
        `${def.quantity_id}: phrase="${def.coveragePhrase}" → ${inferred ?? 'null'}`,
      );
    }
  }
  return failures;
}

/** Phrases adverses (indépendantes des coveragePhrase) — 0 token. */
export function verifyAdversarialQuantityCases(): string[] {
  const cases: Array<[string, string]> = [
    ['Releve la haute pression HP, attendu 25 a 30 bar', 'hp_bar'],
    ['Quelle est la basse pression BP en bar ?', 'bp_bar'],
    ['Verifie la pression du circuit hydraulique, 1,2-2,0 bar', 'pression_circuit_bar'],
    [
      'Regarde si le capteur de pression du circuit est encrasse',
      'pression_circuit_bar',
    ],
    [
      'Verifie la pression au manometre, elle doit etre entre 1,2 et 2,0',
      'pression_circuit_bar',
    ],
    ['Mesure le delta entre HP et BP', 'delta_hp_bp'],
    ['Mesure l amperage du compresseur', 'amperage_compresseur'],
    ['Mesure la surchauffe, on attend 5 a 8 K', 'surchauffe_k'],
    ['Donne la temperature de depart, entre 35 et 45', 't_depart'],
    ['Quelle temperature de retour ?', 't_retour'],
    ['Mesure la continuite de la sonde', 'continuite_sonde_ohm'],
    ['Tu entends un bruit sur la pompe ?', 'bruit_pompe'],
    ['Etat du capteur de temperature ?', 'capteur_etat'],
    ['Quel est le debit en l/min ?', 'debit_l_min'],
    ['Y a-t-il du givre sur l echangeur ?', 'givre'],
  ];
  const failures: string[] = [];
  for (const [phrase, expected] of cases) {
    const got = inferQuantityIdFromText(phrase);
    if (got !== expected) failures.push(`"${phrase}" → ${got ?? 'null'} (attendu ${expected})`);
  }
  return failures;
}

/** Cas de régression frigo / hydraulique (0 token). */
export function verifyQuantityRegressionCases(): string[] {
  return verifyAdversarialQuantityCases();
}
