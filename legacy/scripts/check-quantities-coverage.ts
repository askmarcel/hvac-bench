#!/usr/bin/env tsx
/**
 * Vérifie que chaque MES-* / OBS-* est mappé ou blacklisté.
 * Cas d'échec synthétique : --fixture orphan
 */
import { readFileSync } from 'node:fs';

import { PATHS } from '../lib/v3/paths.js';

type ActionMap = {
  mes: Record<string, { quantities: string[] }>;
  obs: Record<string, { quantity: string }>;
};
type Blacklist = { actions: Array<{ action_id: string }> };
type ActionsV2 = { actions: Array<{ action_id: string }> };

function main() {
  const fixtureOrphan = process.argv.includes('--fixture') && process.argv.includes('orphan');
  const actionMap = JSON.parse(readFileSync(PATHS.actionMap, 'utf8')) as ActionMap;
  const blacklist = JSON.parse(readFileSync(PATHS.actionBlacklist, 'utf8')) as Blacklist;
  const actions = JSON.parse(readFileSync(PATHS.actionsV2, 'utf8')) as ActionsV2;
  const blacklisted = new Set(blacklist.actions.map((a) => a.action_id));

  const mesIds = actions.actions.filter((a) => a.action_id.startsWith('MES-')).map((a) => a.action_id);
  const obsIds = actions.actions.filter((a) => a.action_id.startsWith('OBS-')).map((a) => a.action_id);

  if (fixtureOrphan) {
    mesIds.push('MES-ORPHAN');
  }

  const errors: string[] = [];
  for (const id of mesIds) {
    if (blacklisted.has(id)) continue;
    if (!actionMap.mes[id]) errors.push(`MES non mappé: ${id}`);
  }
  for (const id of obsIds) {
    if (blacklisted.has(id)) continue;
    if (!actionMap.obs[id]) errors.push(`OBS non mappé: ${id}`);
  }

  const report = {
    mes_total: mesIds.length,
    obs_total: obsIds.length,
    blacklisted: [...blacklisted],
    errors,
    pass: errors.length === 0,
  };

  console.log(JSON.stringify(report, null, 2));
  if (!report.pass) process.exit(1);
}

main();
