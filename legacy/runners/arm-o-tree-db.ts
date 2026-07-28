/**
 * Runner batch O_tree_db — gate P2 falsification.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { isExecutedDirectly } from '../lib/cli-entry.js';

import {
  GATE_DIAGNOSTIC_CASE_IDS,
  GATE_ESCALADE_CASE_IDS,
  GATE_ESCALADE_EXCLUSIONS,
  loadGateDiagnosticV3Cases,
} from '../lib/v3/gate-roster.js';
import { loadV3CasesFromPath } from '../lib/v3/gate-roster.js';
import type { V3Case } from '../lib/v3/types.js';
import { scoreEscaladeSubset, scoreV3Run } from '../scorer/v3/index.js';
import { newRunId } from './lib.js';
import { buildRunManifestBase } from './manifest-v2.js';
import { runCaseOtreeDb } from './o-tree-case.js';
import { loadPreregistrationHash } from './preregistration.js';

export type OtreeDbRunResult = {
  runId: string;
  outDir: string;
  diagnosticRecords: ReturnType<typeof runCaseOtreeDb>[];
  escaladeRecords: ReturnType<typeof runCaseOtreeDb>[];
  diagnosticScores: ReturnType<typeof scoreV3Run>;
  escaladeScores: ReturnType<typeof scoreEscaladeSubset>;
};

function loadEscaladeCases(): V3Case[] {
  const all = loadV3CasesFromPath();
  return GATE_ESCALADE_CASE_IDS.map((id) => {
    const c = all.find((x) => x.id === id);
    if (!c) throw new Error(`Cas escalade manquant: ${id}`);
    return c;
  });
}

export function runOtreeDbBatch(options?: {
  runId?: string;
  includeEscalade?: boolean;
  runKind?: string;
  postHoc?: boolean;
  lrProfile?: string;
}): OtreeDbRunResult {
  const runId = options?.runId ?? newRunId('o-tree-db');
  const outDir = resolve(import.meta.dirname, `../runs/${runId}`);
  mkdirSync(outDir, { recursive: true });

  const diagnosticCases = loadGateDiagnosticV3Cases();
  const diagnosticRecords = diagnosticCases.map((c) => {
    const rec = runCaseOtreeDb(c, 0);
    console.log(
      `${c.id}: ${rec.path.join('→')} → ${rec.final_output.state} cause=${rec.cause_id} expected=${c.ground_truth.cause_id}`,
    );
    return rec;
  });

  const escaladeCases = options?.includeEscalade === false ? [] : loadEscaladeCases();
  const escaladeRecords = escaladeCases.map((c) => {
    const rec = runCaseOtreeDb(c, 0);
    console.log(
      `[escalade] ${c.id}: ${rec.path.join('→')} → ${rec.final_output.state} concluded=${rec.concluded}`,
    );
    return rec;
  });

  const allRecords = [...diagnosticRecords, ...escaladeRecords];
  const diagnosticScores = scoreV3Run(diagnosticCases, diagnosticRecords);
  const escaladeScores = scoreEscaladeSubset(escaladeCases, escaladeRecords);

  writeFileSync(
    resolve(outDir, 'raw.jsonl'),
    allRecords.map((r) => JSON.stringify(r)).join('\n') + '\n',
  );
  writeFileSync(
    resolve(outDir, 'score-o-tree-db.json'),
    JSON.stringify(
      {
        diagnostic: diagnosticScores,
        escalade: escaladeScores,
        combined: scoreV3Run([...diagnosticCases, ...escaladeCases], allRecords),
      },
      null,
      2,
    ),
  );

  writeFileSync(
    resolve(outDir, 'manifest.json'),
    JSON.stringify(
      {
        ...buildRunManifestBase('O_tree_db', runId, 1, allRecords.length),
        run_kind: options?.runKind ?? 'falsification_p2_primary',
        post_hoc: options?.postHoc ?? false,
        lr_profile: options?.lrProfile ?? 'tier3_default',
        preregistration_hash: loadPreregistrationHash(),
        roster: {
          gate_diagnostic_case_ids: [...GATE_DIAGNOSTIC_CASE_IDS],
          gate_escalade_case_ids: [...GATE_ESCALADE_CASE_IDS],
          gate_escalade_exclusions: { ...GATE_ESCALADE_EXCLUSIONS },
        },
        scores: { diagnostic: diagnosticScores, escalade: escaladeScores },
      },
      null,
      2,
    ) + '\n',
  );

  return {
    runId,
    outDir,
    diagnosticRecords,
    escaladeRecords,
    diagnosticScores,
    escaladeScores,
  };
}

async function main() {
  const result = runOtreeDbBatch();
  console.log('O_tree_db diagnostic:', {
    conv_at_5: result.diagnosticScores.convergence_at_5,
    fraction: `${result.diagnosticScores.convergence_at_5_numerator}/${result.diagnosticScores.convergence_at_5_denominator}`,
  });
  console.log('O_tree_db escalade:', result.escaladeScores);
  console.log(`Run: ${result.outDir}`);
}

if (isExecutedDirectly(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
