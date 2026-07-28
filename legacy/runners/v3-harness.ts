/**
 * Harnais v3 — chargement cas et replay moteur.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PATHS } from '../lib/v3/paths.js';
import { loadGateDiagnosticV3Cases } from '../lib/v3/gate-roster.js';
import { initSessionV3, replayCaseV3 } from '../lib/v3/engine-v3.js';
import type { V3Case } from '../lib/v3/types.js';

export function loadV3Cases(path = PATHS.pilotV3Pac): V3Case[] {
  const raw = readFileSync(path, 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').filter(Boolean).map((line) => JSON.parse(line) as V3Case);
}

/** 10 cas diagnostiques PAC — roster gate pinné (§ preregistration v3). */
export function loadDiagnosableV3Cases(path?: string): V3Case[] {
  return loadGateDiagnosticV3Cases(path ?? PATHS.pilotV3Pac);
}

export function getV3CaseById(caseId: string, path?: string): V3Case | undefined {
  return loadV3Cases(path).find((c) => c.id === caseId);
}

export { initSessionV3, replayCaseV3 };
