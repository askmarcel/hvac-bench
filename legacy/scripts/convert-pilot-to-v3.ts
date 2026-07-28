#!/usr/bin/env tsx
/**
 * Réécrit les 13 cas PAC pilote v2 → pilot-v3-pac_air_eau.jsonl
 */
import { readFileSync, writeFileSync } from 'node:fs';

import { convertPilotCaseToV3 } from '../lib/v3/convert-pilot-case.js';
import { PATHS } from '../lib/v3/paths.js';

type V2Case = Parameters<typeof convertPilotCaseToV3>[0];

function main() {
  const lines = readFileSync(PATHS.pilotV2, 'utf8').split('\n').filter(Boolean);
  const pac = lines
    .map((l) => JSON.parse(l) as V2Case)
    .filter((c) => c.context?.equipment_type === 'pac_air_eau');

  const out = pac.map((c) => JSON.stringify(convertPilotCaseToV3(c))).join('\n') + '\n';
  writeFileSync(PATHS.pilotV3Pac, out);
  console.log(`Wrote ${pac.length} cases → ${PATHS.pilotV3Pac}`);
}

main();
