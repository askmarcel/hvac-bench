/**
 * Roster gate P2 — dénominateur pinné (10 diagnostiques / 13 pilote PAC).
 */
import { readFileSync } from 'node:fs';

import { loadV2Cases, type PilotCaseExtended } from '../../runners/v2-harness.js';
import { PATHS } from './paths.js';
import type { V3Case } from './types.js';

/** Exclus du conv@5 et de la mesure EIG H1 — escalade légitime. */
export const GATE_ESCALADE_CASE_IDS = ['hb2-0016', 'hb2-0017', 'hb2-0019'] as const;

export const GATE_ESCALADE_EXCLUSIONS = {
  'hb2-0016': 'escalade_legitime — SAV constructeur (U0), déverrouillage usine requis',
  'hb2-0017': 'escalade_legitime — garantie compresseur, ouverture interdite sur site',
  'hb2-0019': 'escalade_legitime — sous-dimensionnement BE, hors périmètre réparation terrain',
} as const satisfies Record<(typeof GATE_ESCALADE_CASE_IDS)[number], string>;

/** 10 cas diagnostiques PAC — dénominateur H1 / H3 conv@5. */
export const GATE_DIAGNOSTIC_CASE_IDS = [
  'hb2-0001',
  'hb2-0002',
  'hb2-0003',
  'hb2-0004',
  'hb2-0005',
  'hb2-0007',
  'hb2-0010',
  'hb2-0011',
  'hb2-0013',
  'hb2-0015',
] as const;

export const GATE_PILOT_PAC_COUNT = 13;
export const GATE_DIAGNOSTIC_COUNT = GATE_DIAGNOSTIC_CASE_IDS.length;

export function isGateDiagnosticCase(caseId: string): boolean {
  return (GATE_DIAGNOSTIC_CASE_IDS as readonly string[]).includes(caseId);
}

function sortByGateOrder<T extends { id: string }>(cases: T[]): T[] {
  const order = new Map(GATE_DIAGNOSTIC_CASE_IDS.map((id, i) => [id, i]));
  return [...cases].sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));
}

export function loadV3CasesFromPath(path = PATHS.pilotV3Pac): V3Case[] {
  const raw = readFileSync(path, 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').filter(Boolean).map((line) => JSON.parse(line) as V3Case);
}

export function loadGateDiagnosticV3Cases(path = PATHS.pilotV3Pac): V3Case[] {
  return sortByGateOrder(loadV3CasesFromPath(path).filter((c) => isGateDiagnosticCase(c.id)));
}

export function loadGateDiagnosticV2Cases(casesPath?: string): PilotCaseExtended[] {
  return sortByGateOrder(
    loadV2Cases(casesPath).filter((c) => isGateDiagnosticCase(c.id)),
  ) as PilotCaseExtended[];
}
