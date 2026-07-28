/**
 * Parité EIG v3 : EIG brute vs pickNextActionV3.
 * Usage: pnpm trace:voi-eig-parity-v3 [case_id]
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { initialHypothesesV3 } from '../lib/v3/candidates.js';
import { computeActionEigV3 } from '../lib/v3/eig-v3.js';
import { pickNextActionV3 } from '../lib/v3/engine-v3.js';
import { buildV3HypothesisActionsMap } from '../lib/v3/eig-v3.js';
import { diagnosticActionIdsV3 } from '../lib/v3/hypothesis-actions.js';
import { analyzeCaseEigTurn0V3, loadActionCosts } from '../lib/voi-eig-analysis.js';
import { getV3CaseById } from '../runners/v3-harness.js';

const caseIds = process.argv[2] ? [process.argv[2]] : ['hb2-0001', 'hb2-0005'];

for (const caseId of caseIds) {
  const c = getV3CaseById(caseId);
  if (!c) {
    console.error(`Cas introuvable: ${caseId}`);
    process.exit(1);
  }

  const costs = loadActionCosts();
  const ids = diagnosticActionIdsV3();
  const hyps = initialHypothesesV3('pac_air_eau', c.symptom.code_present);
  const ha = buildV3HypothesisActionsMap(hyps.map((h) => h.id));
  const eigAnalysis = analyzeCaseEigTurn0V3(c, ids, costs);
  const picked = pickNextActionV3(hyps, ids, costs, new Set(), c.context, ha);

  const report = {
    case_id: caseId,
    generated_at: new Date().toISOString(),
    engine: 'v3',
    eig_max_action: eigAnalysis.eig_max_action,
    engine_pick: picked,
    match: eigAnalysis.eig_max_action === picked,
    pct_exact_zero_eig: eigAnalysis.pct_exact_zero_eig,
    top_eig: eigAnalysis.actions.slice(0, 5).map((a) => ({
      action_id: a.action_id,
      eig_bits: a.eig_bits,
    })),
  };

  const outPath = resolve(
    import.meta.dirname,
    `../reports/voi-eig-parity-v3-${caseId}.json`,
  );
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.error(`Rapport: ${outPath}`);
}
