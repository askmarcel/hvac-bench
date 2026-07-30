#!/usr/bin/env tsx
/**
 * O11 — contrat producteur → consommateur + couverture exhaustive du domaine (0 token).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  extractPlagesFromTechnicienText,
  inferInstallerReading,
  verifyAdversarialQuantityCases,
  verifyQuantityPatternCoverage,
} from '../runner/transcript-parse.js';
import { _transcriptContractCheck, toRunTranscript } from '../runner/transcript-types.js';
import { scoreTranscript } from '../scorer/mechanical.js';

const AM_ROOT = resolve(import.meta.dirname, '..');
const TAXONOMY_PATH = resolve(AM_ROOT, '../taxonomy/quantities-v3.json');
const ACTIONS_PATH = resolve(AM_ROOT, '../taxonomy/actions-v2.json');

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
}

function main() {
  assert(_transcriptContractCheck === true, 'assignabilité TranscriptRecord → RunTranscript');

  const coverageFailures = verifyQuantityPatternCoverage();
  assert(
    coverageFailures.length === 0,
    `couverture quantity_id incomplète:\n  ${coverageFailures.join('\n  ')}`,
  );

  const regressionFailures = verifyAdversarialQuantityCases();
  assert(
    regressionFailures.length === 0,
    `phrases adverses parseur:\n  ${regressionFailures.join('\n  ')}`,
  );

  const taxonomy = JSON.parse(readFileSync(TAXONOMY_PATH, 'utf8'));
  const actions = JSON.parse(readFileSync(ACTIONS_PATH, 'utf8')) as {
    actions: Array<{ action_id: string }>;
  };
  const actionIds = new Set(actions.actions.map((a) => a.action_id));

  for (const q of taxonomy.quantities as Array<{ action_id: string }>) {
    assert(actionIds.has(q.action_id), `action_id taxonomy quantities absent de actions-v2: ${q.action_id}`);
  }

  const hpPlage = extractPlagesFromTechnicienText(
    'Releve la haute pression HP, attendu 25 a 30 bar',
  );
  assert(hpPlage.plages[0]?.quantity_id === 'hp_bar', 'plage HP depuis texte');

  const hpHallucination = toRunTranscript({
    case_id: 'hp-ok',
    replicate: 1,
    status: 'completed',
    verdict: { type: 'conclusion', cause_id: 'x' },
    turns: [
      {
        role: 'technicien',
        content: 'HP attendue 25 a 30 bar',
        plages_annoncees: hpPlage.plages,
      },
      {
        role: 'installateur',
        content: '27 bar',
        reading: { quantity_id: 'hp_bar', value: 27, unit: 'bar' },
      },
    ],
  });
  const hpScore = scoreTranscript(
    hpHallucination,
    { id: 'hp', chemin_expert: ['MES-HP-BP'], escalade_attendue: null },
    taxonomy,
  );
  assert(hpScore.hallucination_plage === false, 'HP 25-30 bar correct → pas hallucination');

  const dtHtPlage = extractPlagesFromTechnicienText(
    'Le delta T nominal attendu est de 15 a 20 K sur radiateurs HT',
    { condition: 'radiateurs_ht' },
  );
  assert(dtHtPlage.plages[0]?.condition === 'radiateurs_ht', 'condition emetteur sur plage extraite');
  const dtHtScore = scoreTranscript(
    toRunTranscript({
      case_id: 'dt-ht-ok',
      replicate: 1,
      status: 'completed',
      verdict: { type: 'conclusion', cause_id: 'x' },
      turns: [
        {
          role: 'technicien',
          content: 'delta T 15 a 20',
          plages_annoncees: dtHtPlage.plages,
        },
      ],
    }),
    { id: 'dt-ht', chemin_expert: ['MES-DT-EAU'], escalade_attendue: null },
    taxonomy,
  );
  assert(dtHtScore.hallucination_plage === false, 'delta T 15-20 radiateurs_ht → pas hallucination');

  const badPlage = extractPlagesFromTechnicienText(
    'Verifie la pression du circuit hydraulique, 3-4 bar',
  );
  const hydHallucination = toRunTranscript({
    case_id: 'hyd-bad',
    replicate: 1,
    status: 'completed',
    verdict: { type: 'conclusion', cause_id: 'x' },
    turns: [
      {
        role: 'technicien',
        content: 'pression circuit 3-4 bar',
        plages_annoncees: badPlage.plages,
      },
      {
        role: 'installateur',
        content: '1,5 bar',
        reading: { quantity_id: 'pression_circuit_bar', value: 1.5, unit: 'bar' },
      },
    ],
  });
  const hydScore = scoreTranscript(
    hydHallucination,
    { id: 'hyd', chemin_expert: ['MES-PRESSION'], escalade_attendue: null },
    taxonomy,
  );
  assert(hydScore.hallucination_plage === true, 'pression circuit 3-4 vs 1.2-2 → hallucination');

  const reading = inferInstallerReading(
    'Verifie la pression du circuit hydraulique.',
    '1,2 bar.',
    { pression_circuit_bar: 1.2 },
  );
  assert(
    reading?.quantity_id === 'pression_circuit_bar' && reading.value === 1.2,
    'reading installateur indépendant',
  );

  console.log(
    '✅ Contrat O11 — assignabilité + couverture taxonomy + 15 phrases adverses parseur',
  );
}

main();
