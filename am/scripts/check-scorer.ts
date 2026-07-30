#!/usr/bin/env tsx
/**
 * am:check-scorer — T6. Aucun LLM : entièrement déterministe, doit tourner partout.
 * Vérifie que chaque critère mécanique détecte bien SA fixture d'échec, que le cas
 * propre passe tout, et que l'agrégat à dénominateur nul retourne null (jamais 0/0=vert).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  aggregateRate,
  scoreTranscript,
  type AmCaseForScoring,
  type MechanicalScore,
  type QuantitiesTaxonomy,
  type RunTranscript,
  type ScoringArm,
} from '../scorer/mechanical.js';

const AM_ROOT = resolve(import.meta.dirname, '..');
const FIXTURES_PATH = resolve(AM_ROOT, 'scorer/fixtures/mechanical-fixtures.json');
const TAXONOMY_PATH = resolve(AM_ROOT, '../taxonomy/quantities-v3.json');

type Fixture = {
  name: string;
  arm?: ScoringArm;
  case: AmCaseForScoring;
  transcript: RunTranscript;
  expected: Partial<{
    escalade_ok: boolean | null;
    conclusion_sans_mesure: boolean | null;
    hallucination_plage: boolean | null;
    nb_tours: number;
    ratio_efficience: number;
  }>;
};

function checkField<K extends keyof Fixture['expected']>(
  fx: Fixture,
  score: MechanicalScore,
  key: K,
  actual: unknown,
): string | null {
  if (!(key in fx.expected)) return null; // pas asserté par cette fixture
  const expected = fx.expected[key];
  if (actual !== expected) {
    return `${String(key)}: attendu ${JSON.stringify(expected)}, obtenu ${JSON.stringify(actual)}`;
  }
  return null;
}

function main() {
  const { fixtures } = JSON.parse(readFileSync(FIXTURES_PATH, 'utf8')) as { fixtures: Fixture[] };
  const taxonomy = JSON.parse(readFileSync(TAXONOMY_PATH, 'utf8')) as QuantitiesTaxonomy;

  let pass = 0;
  const lines: string[] = [];
  const scores: Record<string, MechanicalScore> = {};

  for (const fx of fixtures) {
    const score = scoreTranscript(fx.transcript, fx.case, taxonomy, fx.arm);
    scores[fx.name] = score;

    const errors = [
      checkField(fx, score, 'escalade_ok', score.escalade_ok),
      checkField(fx, score, 'conclusion_sans_mesure', score.conclusion_sans_mesure),
      checkField(fx, score, 'hallucination_plage', score.hallucination_plage),
      checkField(fx, score, 'nb_tours', score.nb_tours),
      checkField(fx, score, 'ratio_efficience', score.chemin.ratio_efficience),
    ].filter((e): e is string => e !== null);

    if (errors.length === 0) {
      pass++;
      lines.push(`✅ ${fx.name} — score: ${JSON.stringify(score)}`);
    } else {
      lines.push(`❌ ${fx.name}\n   ${errors.join('\n   ')}\n   score complet: ${JSON.stringify(score)}`);
    }
  }

  console.log(lines.join('\n\n'));
  console.log(`\n${pass}/${fixtures.length} fixtures conformes.`);

  // Dénominateur nul : clean-pass et conclusion-sans-mesure-violation ont tous deux
  // escalade_attendue=null → escalade_ok=null pour les deux → agrégat doit être null.
  const nullDenomInputs = [
    scores['clean-pass']?.escalade_ok,
    scores['conclusion-sans-mesure-violation']?.escalade_ok,
  ];
  const nullDenomRate = aggregateRate(nullDenomInputs as (boolean | null)[]);
  const nullDenomOk = nullDenomRate === null;
  console.log(
    `\n${nullDenomOk ? '✅' : '❌'} agrégat dénominateur nul (2 cas sans escalade attendue) → ${JSON.stringify(nullDenomRate)} ${nullDenomOk ? '(correct: null, pas un faux 0/0 vert)' : '(FAUX: devrait être null)'}`,
  );

  // Contrôle positif : un agrégat avec dénominateur non nul doit bien calculer un taux.
  const mixedRate = aggregateRate([true, false, true]);
  const mixedOk = mixedRate === 2 / 3;
  console.log(`${mixedOk ? '✅' : '❌'} agrégat témoin [true,false,true] → ${mixedRate} (attendu 0.666...)`);

  const allOk = pass === fixtures.length && nullDenomOk && mixedOk;
  if (!allOk) process.exit(1);
}

main();
