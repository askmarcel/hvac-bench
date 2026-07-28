/**
 * Oracle O_bayes — rejoue expert_path avec annotations cas (tests[].discriminates, polarity).
 *
 * Usage: pnpm run:v2:arm-o-bayes
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { scoreV2Run } from '../scorer/v2/index.js';
import { newRunId } from './lib.js';
import { buildRunManifestBase } from './manifest-v2.js';
import { O_BAYES_MIN_CONV_AT_5, runCaseObayes } from './o-bayes-case.js';
import { loadPreregistrationHash } from './preregistration.js';
import { loadV2Cases, trueCauseId, type PilotCaseExtended } from './v2-harness.js';

function main() {
  const cases = loadV2Cases().filter(
    (c) => c.meta.family !== 'escalade_legitime' && c.meta.family !== 'hors_corpus',
  ) as PilotCaseExtended[];

  const runId = newRunId('o-bayes');
  const outDir = resolve(import.meta.dirname, `../runs/${runId}`);
  mkdirSync(outDir, { recursive: true });

  const records = cases.map((c) => {
    const rec = runCaseObayes(c, 0);
    console.log(
      `${c.id}: ${rec.path.join('→')} → ${rec.final_output.state} cause=${rec.cause_id} expected=${trueCauseId(c)}`,
    );
    return rec;
  });

  const scores = scoreV2Run(cases, records);
  const conv = scores.convergence_at_5;

  writeFileSync(resolve(outDir, 'raw.jsonl'), records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  writeFileSync(resolve(outDir, 'score-o-bayes.json'), JSON.stringify(scores, null, 2));
  writeFileSync(
    resolve(outDir, 'manifest.json'),
    JSON.stringify(
      {
        ...buildRunManifestBase('O_bayes', runId, 1, cases.length),
        scorer_version: scores.scorer_version,
        preregistration_hash: loadPreregistrationHash(),
        regression_gate: {
          min_conv_at_5: O_BAYES_MIN_CONV_AT_5,
          actual_conv_at_5: conv,
          passed: conv >= O_BAYES_MIN_CONV_AT_5 && conv < 1,
          posterior_snapshot: 'fixtures/o-bayes-posterior-snapshot-v1.json',
        },
      },
      null,
      2,
    ) + '\n',
  );

  console.log('O_bayes metrics:', scores);
  if (conv >= 1) {
    console.error('O_bayes TAUTOLOGY: conv@5=1.00 — court-circuit resolves actif ?');
    process.exit(1);
  }
  if (conv < O_BAYES_MIN_CONV_AT_5) {
    console.error(`O_bayes regression FAILED: conv@5=${conv} < ${O_BAYES_MIN_CONV_AT_5} (11/15)`);
    process.exit(1);
  }
}

main();
