/**
 * Oracle O_bayes_db — rejoue expert_path via bayesUpdate + matrice Supabase.
 *
 * Usage:
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   pnpm run:v2:arm-o-bayes-db
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isExecutedDirectly } from '../lib/cli-entry.js';

import { createClient } from '@supabase/supabase-js';

import {
  bayesUpdate,
  buildTestFromMatrix,
  shouldConclude,
  type HypothesisState,
} from '../lib/bayes-engine.js';
import { scoreV2Run } from '../scorer/v2/index.js';
import { newRunId } from './lib.js';
import { buildRunManifestBase } from './manifest-v2.js';
import { loadPreregistrationHash } from './preregistration.js';
import {
  buildRunRecord,
  loadV2Cases,
  lookupObservation,
  T_MAX,
  trueCauseId,
  type PilotCaseExtended,
} from './v2-harness.js';

const O_BAYES_BASELINE = {
  conv_at_5_diagnosable: 12 / 15,
  conv_at_5_total_with_escalations: 12 / 15,
  note: 'Seuil 0,85 pré-calibration ; sweep D/R requis avant abaissement plateau',
};

export async function loadHypothesisMatrix(
  supabase: ReturnType<typeof createClient>,
  hypothesisIds: string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (!hypothesisIds.length) return map;

  const { data, error } = await supabase
    .from('diag_hypotheses')
    .select('hypothesis_id, discriminating_actions')
    .in('hypothesis_id', hypothesisIds);

  if (error) throw error;
  for (const row of data ?? []) {
    map.set(row.hypothesis_id, (row.discriminating_actions as string[]) ?? []);
  }
  return map;
}

export function runCaseObayesDb(
  c: PilotCaseExtended,
  replicate: number,
  matrix: Map<string, string[]>,
) {
  const path: string[] = [];
  let hypotheses: HypothesisState[] = c.hypotheses.map((h) => ({
    id: h.id,
    label: h.label ?? h.id,
    prior: h.prior ?? 1 / c.hypotheses.length,
    n_observations: (h as { n_observations?: number }).n_observations,
  }));
  const hypothesisIds = hypotheses.map((h) => h.id);
  let discriminantExecuted = false;
  let turns = 0;
  let concluded = false;
  let cause_id: string | null = null;
  let final_output: Record<string, unknown> = { state: 'non_convergent' };

  for (const actionId of c.expert_path) {
    if (turns >= T_MAX) break;
    const { observation } = lookupObservation(c, actionId);
    path.push(actionId);
    turns++;

    const test = buildTestFromMatrix(actionId, observation, hypothesisIds, matrix);
    if (test.discriminates.length > 0 || test.resolves) {
      discriminantExecuted = true;
    }
    hypotheses = bayesUpdate(hypotheses, test);

    const { conclude, causeId } = shouldConclude(hypotheses, discriminantExecuted);
    if (conclude && causeId) {
      concluded = true;
      cause_id = causeId;
      final_output = {
        state: 'conclusion',
        cause_id: causeId,
        hypotheses_ranked: hypotheses,
        turn: turns,
      };
      break;
    }
  }

  if (!concluded && turns >= T_MAX) {
    final_output = { state: 'escalation', turn: turns };
  } else if (!concluded) {
    final_output = {
      state: 'non_convergent',
      hypotheses_ranked: hypotheses,
      turn: turns,
    };
  }

  return buildRunRecord({
    c,
    arm: 'O_bayes_db',
    replicate,
    path,
    concluded,
    cause_id,
    turns,
    final_output,
    hypotheses_final: hypotheses,
  });
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error('Définir NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const cases = loadV2Cases() as PilotCaseExtended[];
  const allIds = [...new Set(cases.flatMap((c) => c.hypotheses.map((h) => h.id)))];
  const matrix = await loadHypothesisMatrix(supabase, allIds);

  const runId = newRunId('o-bayes-db');
  const outDir = resolve(import.meta.dirname, `../runs/${runId}`);
  mkdirSync(outDir, { recursive: true });

  const records = cases.map((c) => {
    const rec = runCaseObayesDb(c, 0, matrix);
    console.log(
      `${c.id}: ${rec.path.join('→')} → ${rec.final_output.state} cause=${rec.cause_id} expected=${trueCauseId(c)}`,
    );
    return rec;
  });

  const scores = scoreV2Run(cases, records);
  const decomposition = {
    O_bayes_baseline: O_BAYES_BASELINE,
    O_bayes_db: {
      convergence_at_5: scores.convergence_at_5,
      convergence_at_3: scores.convergence_at_3,
    },
    matrix_coverage: {
      hypotheses_with_actions: [...matrix.values()].filter((a) => a.length > 0).length,
      total_hypotheses: matrix.size,
    },
    cost_matrix_genericity: O_BAYES_BASELINE.conv_at_5_diagnosable - scores.convergence_at_5,
  };

  writeFileSync(resolve(outDir, 'raw.jsonl'), records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  writeFileSync(resolve(outDir, 'score-o-bayes-db.json'), JSON.stringify(scores, null, 2));
  writeFileSync(resolve(outDir, 'oracle-decomposition.json'), JSON.stringify(decomposition, null, 2));
  writeFileSync(
    resolve(outDir, 'manifest.json'),
    JSON.stringify(
      {
        ...buildRunManifestBase('O_bayes_db', runId, 1, cases.length),
        scorer_version: scores.scorer_version,
        preregistration_hash: loadPreregistrationHash(),
        oracles: {
          O_bayes: O_BAYES_BASELINE,
          O_bayes_db: scores,
          decomposition,
        },
      },
      null,
      2,
    ) + '\n',
  );

  console.log('O_bayes_db metrics:', scores);
  console.log('Decomposition:', decomposition);
}

if (isExecutedDirectly(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
