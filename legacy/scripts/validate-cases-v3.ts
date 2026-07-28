#!/usr/bin/env tsx
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import { PATHS } from '../lib/v3/paths.js';

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

const schema = JSON.parse(readFileSync(PATHS.schemaV3, 'utf8'));
const actionMap = JSON.parse(readFileSync(PATHS.actionMap, 'utf8')) as {
  mes: Record<string, { quantities: string[] }>;
  obs: Record<string, { quantity: string }>;
};
const validate = ajv.compile(schema);

type V3Case = {
  id: string;
  context: { equipment_type: string };
  observations: Array<{ action_id: string; reading: { quantity_id: string } }>;
  ground_truth: { cause_id: string };
  expert_path: string[];
  harvest: { reformulated: boolean };
};

function collectJsonlFiles(target: string): string[] {
  const stat = statSync(target, { throwIfNoEntry: false });
  if (!stat) return [];
  if (stat.isFile() && target.endsWith('.jsonl')) return [target];
  if (!stat.isDirectory()) return [];
  return readdirSync(target).flatMap((e) => collectJsonlFiles(resolve(target, e)));
}

function semanticErrors(c: V3Case, file: string, line: number): string[] {
  const errors: string[] = [];
  if (c.context.equipment_type !== 'pac_air_eau') {
    errors.push('equipment_type must be pac_air_eau in P0');
  }
  if (!c.harvest.reformulated) errors.push('harvest.reformulated must be true');
  const obsActions = new Set(c.observations.map((o) => o.action_id));
  for (const aid of c.expert_path) {
    if (!obsActions.has(aid)) errors.push(`expert_path ${aid} missing from observations`);
  }
  for (const obs of c.observations) {
    const mes = actionMap.mes[obs.action_id];
    const ob = actionMap.obs[obs.action_id];
    if (mes && !mes.quantities.includes(obs.reading.quantity_id)) {
      errors.push(`${obs.action_id} reading ${obs.reading.quantity_id} not in map`);
    }
    if (ob && ob.quantity !== obs.reading.quantity_id) {
      errors.push(`${obs.action_id} expected ${ob.quantity}`);
    }
  }
  return errors.map((e) => `${file}:${line} ${e}`);
}

function main() {
  const args = process.argv.slice(2);
  const pathsIdx = args.indexOf('--paths');
  const targets =
    pathsIdx >= 0
      ? args.slice(pathsIdx + 1)
      : [
          resolve(import.meta.dirname, '../dataset/pilot/pilot-v3-pac_air_eau.jsonl'),
          PATHS.historicalV3,
        ];

  const files = targets.flatMap((p) => collectJsonlFiles(resolve(p))).filter((f) => {
    try {
      statSync(f);
      return true;
    } catch {
      return false;
    }
  });

  if (files.length === 0) {
    console.error('No v3 JSONL files found.');
    process.exit(1);
  }

  let failed = 0;
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
    for (const [index, line] of lines.entries()) {
      const parsed = JSON.parse(line) as V3Case;
      if (!validate(parsed)) {
        failed += 1;
        console.error(file, index + 1, validate.errors);
        continue;
      }
      const sem = semanticErrors(parsed, file, index + 1);
      if (sem.length) {
        failed += 1;
        for (const e of sem) console.error(e);
      }
    }
  }
  if (failed) process.exit(1);
  console.log(`validate-cases-v3: OK (${files.length} files)`);
}

main();
