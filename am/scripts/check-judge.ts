#!/usr/bin/env tsx
/**
 * am:check-judge — rejoue les 6 transcripts fixtures du juge (T5), 3 passages chacun.
 * Exige : classement 6/6 conforme à l'attendu ET variance nulle entre les 3 passages
 * (même grade à chaque fois, température 0). Échoue proprement si pas de clé API —
 * jamais de faux succès.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { MissingApiKeyError } from '../llm-client.js';
import { judgeTranscript, type JudgeGrade, type Verite } from '../judge/judge.js';

const AM_ROOT = resolve(import.meta.dirname, '..');
const FIXTURES_PATH = resolve(AM_ROOT, 'judge/fixtures/judge-transcripts.json');
const REPLICATES = 3;

type Fixture = {
  name: string;
  case_id: string;
  transcript: string;
  expected: JudgeGrade;
};

function loadVerite(caseId: string): Verite {
  const path = resolve(AM_ROOT, 'cases/dev', `${caseId}.json`);
  const c = JSON.parse(readFileSync(path, 'utf8')) as { verite: Verite };
  return c.verite;
}

function gradesEqual(a: JudgeGrade, b: JudgeGrade): boolean {
  return (
    a.cause_ok === b.cause_ok &&
    a.solution_ok === b.solution_ok &&
    a.piege === b.piege &&
    a.valeur_attendue_annoncee === b.valeur_attendue_annoncee
  );
}

function gradeMatchesExpected(actual: JudgeGrade, expected: JudgeGrade): boolean {
  return gradesEqual(actual, expected);
}

async function main() {
  const { fixtures } = JSON.parse(readFileSync(FIXTURES_PATH, 'utf8')) as { fixtures: Fixture[] };

  let correctCount = 0;
  let zeroVarianceCount = 0;
  const lines: string[] = [];

  for (const fx of fixtures) {
    const verite = loadVerite(fx.case_id);
    try {
      const grades: JudgeGrade[] = [];
      for (let i = 0; i < REPLICATES; i++) {
        grades.push(await judgeTranscript({ verite, transcript: fx.transcript }));
      }

      const matchesExpected = grades.every((g) => gradeMatchesExpected(g, fx.expected));
      const noVariance = grades.every((g) => gradesEqual(g, grades[0]));

      if (matchesExpected) correctCount++;
      if (noVariance) zeroVarianceCount++;

      const ok = matchesExpected && noVariance;
      lines.push(
        `${ok ? '✅' : '❌'} ${fx.name}\n` +
          `   attendu:  ${JSON.stringify(fx.expected)}\n` +
          grades.map((g, i) => `   passage ${i + 1}: ${JSON.stringify(g)}`).join('\n') +
          (!matchesExpected ? '\n   → classement incorrect' : '') +
          (!noVariance ? '\n   → variance entre passages (température 0 attendue déterministe)' : ''),
      );
    } catch (e) {
      if (e instanceof MissingApiKeyError) throw e; // remonte tel quel, géré en bas
      lines.push(`❌ ${fx.name} — erreur d'appel: ${(e as Error).message}`);
    }
  }

  console.log(lines.join('\n\n'));
  console.log(
    `\n${correctCount}/${fixtures.length} classements corrects · ${zeroVarianceCount}/${fixtures.length} à variance nulle.`,
  );
  if (correctCount < fixtures.length || zeroVarianceCount < fixtures.length) process.exit(1);
}

main().catch((e) => {
  if (e instanceof MissingApiKeyError) {
    console.error(`\n🚫 am:check-judge BLOQUÉ (pas un échec de test, une impossibilité de test) : ${e.message}`);
    console.error('Définir AM_JUDGE_API_KEY (ou OPENROUTER_API_KEY / OPENAI_API_KEY) et AM_JUDGE_MODEL pour exécuter ce check.');
    process.exit(2);
  }
  console.error(e);
  process.exit(1);
});
