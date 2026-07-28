/**
 * Orchestrateur P2 falsification — ordre protocolaire figé.
 * Usage: pnpm run:v3:falsification
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isExecutedDirectly } from '../lib/cli-entry.js';

import { GATE_DIAGNOSTIC_CASE_IDS, GATE_ESCALADE_CASE_IDS } from '../lib/v3/gate-roster.js';
import { resetKnowledgeCache } from '../lib/v3/knowledge-loader.js';
import { runOtreeDbBatch } from '../runners/arm-o-tree-db.js';
import { loadPreregistrationHash } from '../runners/preregistration.js';
import { recalibrateOracleBaselinesRoster10 } from './recalibrate-oracle-baselines-roster10.js';
import { runLrGranularitySweep } from './sweep-lr-granularity-v3.js';

function p3Decision(convAt5: number, numerator: number, denominator: number): string {
  if (convAt5 >= 0.55) {
    return `**GO P3** — conv@5 = ${numerator}/${denominator} (${convAt5.toFixed(3)}) ≥ 0,55`;
  }
  if (convAt5 < 0.4) {
    return `**NO-GO P3** — conv@5 = ${numerator}/${denominator} (${convAt5.toFixed(3)}) < 0,40 ; prémisse « connaissance publique suffit » infirmée ; garder moteur v3, repivoter élicitation Marcel lourde`;
  }
  return `**ZONE GRISE** — conv@5 = ${numerator}/${denominator} (${convAt5.toFixed(3)}) entre 0,40 et 0,55 ; analyse d'erreurs cas par cas avant décision`;
}

function escGatePass(recall: number, falseConclusions: number): boolean {
  return recall === 1 && falseConclusions === 0;
}

export async function runFalsificationV3() {
  resetKnowledgeCache();
  const date = new Date().toISOString().slice(0, 10);

  console.log('\n=== (a) Baselines roster-10 ===');
  const baselines = await recalibrateOracleBaselinesRoster10();

  console.log('\n=== (b) O_tree_db — H3 (10 diagnostiques) + gate escalade (3) ===');
  resetKnowledgeCache();
  const otree = runOtreeDbBatch({ runKind: 'falsification_p2_primary' });

  console.log('\n=== (c) H4 — sweep granularité LR ===');
  resetKnowledgeCache();
  const h4 = runLrGranularitySweep();

  const h3 = otree.diagnosticScores;
  const esc = otree.escaladeScores;
  const escPass = escGatePass(esc.escalation_recall, esc.false_conclusions_on_escalade);

  const caseTable = otree.diagnosticRecords
    .map((r) => {
      const ok =
        r.concluded && r.cause_id === r.true_cause_id && r.turns <= 5 ? '✅' : '❌';
      return `| ${r.case_id} | ${r.turns} | ${r.cause_id ?? '—'} | ${r.true_cause_id} | ${r.final_output.state} | ${ok} |`;
    })
    .join('\n');

  const escTable = otree.escaladeRecords
    .map((r) => {
      const ok = r.final_output.state === 'escalation' && !r.concluded ? '✅' : '❌';
      return `| ${r.case_id} | ${r.path.join('→')} | ${r.final_output.state} | concluded=${r.concluded} | ${ok} |`;
    })
    .join('\n');

  const ob = baselines.report.O_bayes.roster_10;
  const obdb = baselines.report.O_bayes_db.roster_10;

  const md = `# Rapport falsification v3 — P2 gate

**Date** : ${date}  
**Run kind** : falsification_p2_primary  
**Prereg hash** : ${loadPreregistrationHash()}

## Roster

- **10 diagnostiques** (H3) : ${GATE_DIAGNOSTIC_CASE_IDS.join(', ')}
- **3 escalade** (gate secondaire) : ${GATE_ESCALADE_CASE_IDS.join(', ')}

## Baselines roster-10 (recalculées)

| Oracle | Roster-10 | Historique 15 cas |
|--------|-----------|-------------------|
| O_bayes | ${ob.numerator}/${ob.denominator} = **${ob.rate.toFixed(3)}** | ${baselines.report.historical_15_all_families.O_bayes.fraction} |
| O_bayes_db | ${obdb.status === 'ok' ? `${obdb.numerator}/${obdb.denominator} = **${obdb.rate.toFixed(3)}**` : 'skipped (Supabase)'} | ${baselines.report.historical_15_all_families.O_bayes_db.fraction} |

Baseline de référence H3 : **O_bayes_db roster-10**${obdb.status === 'ok' ? ` = ${obdb.rate.toFixed(3)}` : ' (non mesuré — credentials Supabase manquants)'} ; plafond **O_bayes roster-10** = ${ob.rate.toFixed(3)}.

## H3 — O_tree_db (juge principal)

| Métrique | Valeur | Seuil |
|----------|--------|-------|
| conv@5 | **${h3.convergence_at_5_numerator}/${h3.convergence_at_5_denominator}** = ${h3.convergence_at_5.toFixed(3)} | ≥ 0,55 |
| premature_closure_rate | ${h3.premature_closure_rate ?? 'null'} | — |

**Verdict H3** : ${h3.convergence_at_5 >= 0.55 ? 'PASS' : h3.convergence_at_5 < 0.4 ? 'FAIL' : 'INDÉTERMINÉ (zone grise)'}

### Cas par cas (diagnostiques)

| Cas | Turns | Cause prédite | Cause vraie | État | OK |
|-----|-------|---------------|-------------|------|----|
${caseTable}

## Gate escalade (secondaire bloquant)

| Métrique | Valeur | Attendu |
|----------|--------|---------|
| escalation_recall | ${esc.escalation_recall_numerator}/${esc.escalation_recall_denominator} | 3/3 |
| false_conclusions_on_escalade | ${esc.false_conclusions_on_escalade} | 0 |

**Verdict escalade** : ${escPass ? 'PASS' : 'FAIL'}

| Cas | Chemin | État | Concluded | OK |
|-----|--------|------|-----------|-----|
${escTable}

## H4 — Granularité LR

| Profil | LR (fort/moyen/faible) | conv@5 |
|--------|------------------------|--------|
| tier3_default | ${h4.report.profiles[0]!.lr_tiers.fort}/${h4.report.profiles[0]!.lr_tiers.moyen}/${h4.report.profiles[0]!.lr_tiers.faible} | ${h4.report.profiles[0]!.numerator}/${h4.report.profiles[0]!.denominator} |
| adjusted | ${h4.report.profiles[1]!.lr_tiers.fort}/${h4.report.profiles[1]!.lr_tiers.moyen}/${h4.report.profiles[1]!.lr_tiers.faible} | ${h4.report.profiles[1]!.numerator}/${h4.report.profiles[1]!.denominator} |

Delta : **${h4.report.delta_cases} cas** (seuil ≤ 1) — **${h4.report.verdict}**

## Décision P3

${p3Decision(h3.convergence_at_5, h3.convergence_at_5_numerator, h3.convergence_at_5_denominator)}

${!escPass ? '\n> **Note** : gate escalade en échec — corriger avant P3 même si H3 passe.\n' : ''}

## Artefacts

- Baselines : \`${baselines.outPath}\`
- Run O_tree_db : \`${otree.outDir}\`
- Sweep H4 : \`${h4.outPath}\`

## Discipline

Premier run P2 — \`post_hoc: false\`. Toute retouche arbre post-run requalifie le run suivant.
`;

  const reportsDir = resolve(import.meta.dirname, '../reports');
  mkdirSync(reportsDir, { recursive: true });
  const reportPath = resolve(reportsDir, `falsification-v3-${date}.md`);
  writeFileSync(reportPath, md);

  const summaryPath = resolve(reportsDir, `falsification-v3-${date}.json`);
  writeFileSync(
    summaryPath,
    JSON.stringify(
      {
        date,
        baselines: baselines.report,
        h3: {
          conv_at_5: h3.convergence_at_5,
          numerator: h3.convergence_at_5_numerator,
          denominator: h3.convergence_at_5_denominator,
          verdict: h3.convergence_at_5 >= 0.55 ? 'PASS' : h3.convergence_at_5 < 0.4 ? 'FAIL' : 'GRAY',
        },
        escalade: { ...esc, pass: escPass },
        h4: h4.report,
        p3_decision: p3Decision(
          h3.convergence_at_5,
          h3.convergence_at_5_numerator,
          h3.convergence_at_5_denominator,
        ),
        runs: { o_tree_db: otree.outDir },
      },
      null,
      2,
    ) + '\n',
  );

  console.log(`\nRapport: ${reportPath}`);
  return { reportPath, summaryPath, h3, esc, h4: h4.report, escPass };
}

async function main() {
  await runFalsificationV3();
}

if (isExecutedDirectly(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
