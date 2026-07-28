/**
 * Bras H — baseline humaine (protocole aveugle Marcel + techniciens).
 *
 * Lit les annotations depuis workflow/pilot-v2-human-review.csv
 * Format CSV: case_id,human_cause_id,reviewer,blind
 *
 * Usage: pnpm run:v2:arm-h [--csv workflow/pilot-v2-human-review.csv]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { scoreV2Run } from '../scorer/v2/index.js';
import { newRunId } from './lib.js';
import { buildRunManifestBase } from './manifest-v2.js';
import { loadPreregistrationHash } from './preregistration.js';
import { buildRunRecord, loadV2Cases, trueCauseId } from './v2-harness.js';

type HumanRow = {
  case_id: string;
  human_cause_id: string;
  reviewer: string;
  blind: string;
};

function parseCsv(path: string): HumanRow[] {
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, 'utf8').trim().split('\n');
  const [, ...rows] = lines;
  return rows
    .filter(Boolean)
    .map((line) => {
      const [case_id, human_cause_id, reviewer, blind] = line.split(',');
      return {
        case_id: case_id!,
        human_cause_id: (human_cause_id ?? '').trim(),
        reviewer: reviewer?.trim() || 'unknown',
        blind: blind?.trim() || '1',
      };
    })
    .filter((r) => r.human_cause_id.length > 0);
}

function writeTemplate(csvPath: string) {
  const cases = loadV2Cases();
  const lines = ['case_id,human_cause_id,reviewer,blind'];
  for (const c of cases) {
    lines.push(`${c.id},,marcel,1`);
  }
  writeFileSync(csvPath, lines.join('\n') + '\n');
  console.log(`Template écrit : ${csvPath} (${cases.length} cas, human_cause_id à remplir)`);
}

function main() {
  if (process.argv.includes('--init-template')) {
    const csvPath = resolve(import.meta.dirname, '../workflow/pilot-v2-human-review.csv');
    writeTemplate(csvPath);
    return;
  }

  const csvIdx = process.argv.indexOf('--csv');
  const csvPath =
    csvIdx >= 0
      ? resolve(process.argv[csvIdx + 1]!)
      : resolve(import.meta.dirname, '../workflow/pilot-v2-human-review.csv');

  const cases = loadV2Cases();
  const annotations = parseCsv(csvPath);

  if (!annotations.length) {
    console.error(`Aucune annotation humaine complétée dans ${csvPath}`);
    console.error('Remplir human_cause_id (vocabulaire canonique) ou lancer: pnpm run:v2:arm-h -- --init-template');
    process.exit(1);
  }

  const runId = newRunId('arm-h');
  const outDir = resolve(import.meta.dirname, `../runs/${runId}`);
  mkdirSync(outDir, { recursive: true });

  const annMap = new Map(annotations.map((a) => [a.case_id, a]));
  const records = cases.map((c) => {
    const ann = annMap.get(c.id);
    const expected = trueCauseId(c);
    const cause_id = ann?.human_cause_id ?? null;
    const concluded = cause_id === expected;
    return buildRunRecord({
      c,
      arm: 'H',
      replicate: 0,
      path: [],
      concluded,
      cause_id,
      turns: 0,
      final_output: {
        state: concluded ? 'conclusion' : 'non_convergent',
        cause_id,
        reviewer: ann?.reviewer,
        blind: ann?.blind === '1',
      },
    });
  });

  const scores = scoreV2Run(cases, records);
  writeFileSync(resolve(outDir, 'raw.jsonl'), records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  writeFileSync(resolve(outDir, 'score-h.json'), JSON.stringify(scores, null, 2));
  writeFileSync(
    resolve(outDir, 'manifest.json'),
    JSON.stringify(
      {
        ...buildRunManifestBase('H', runId, 1, cases.length),
        scorer_version: scores.scorer_version,
        preregistration_hash: loadPreregistrationHash(),
        protocol: 'docs/bras-h-protocol.md',
      },
      null,
      2,
    ) + '\n',
  );

  console.log('Bras H metrics:', scores);
  console.log(`Annotated ${annotations.length}/${cases.length} cases`);
}

main();
