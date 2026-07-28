/**
 * Migre polarity sur les tests du pilote (corrige signe inversé).
 * Usage: pnpm exec tsx scripts/migrate-polarity-pilot.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

type TestRow = {
  action_id: string;
  observation: string;
  discriminates: string[];
  eliminates: string[];
  polarity?: 'supports' | 'refutes' | 'neutral';
  [key: string]: unknown;
};

type CaseRow = { id: string; tests: TestRow[]; [key: string]: unknown };

function inferPolarity(
  observation: string,
  test?: Pick<TestRow, 'discriminates' | 'resolves'>,
): 'supports' | 'refutes' | 'neutral' {
  // Résolution après réparation sur cause discriminée = confirmation (pas « stable » générique)
  if (test?.resolves && (test.discriminates?.length ?? 0) > 0) {
    if (
      /rétabli|rétablissement|disparait|disparaît|ne revient plus|efficace|corrigé|corrige/i.test(
        observation,
      )
    ) {
      return 'supports';
    }
  }
  if (/remplacement inutile|déjà fait.*inefficace|inefficace/i.test(observation)) {
    return 'refutes';
  }
  if (/disparait|disparaît|résolu|corrige|ne revient plus|efficace/i.test(observation)) return 'supports';
  if (/conforme|normal|dans la plage|ok\b|rien d.anormal/i.test(observation)) return 'refutes';
  if (/stable/i.test(observation) && !/après|remplacement|remplac/i.test(observation)) return 'refutes';
  if (/anormal|hors plage|colmat|bouch|défaut|defaut|vide|insuffisant|encrass/i.test(observation)) {
    return 'supports';
  }
  return 'neutral';
}

function main() {
  const pilotPath = resolve(dirname(fileURLToPath(import.meta.url)), '../dataset/pilot/pilot-v2.jsonl');
  const cases: CaseRow[] = readFileSync(pilotPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as CaseRow);

  let updated = 0;
  for (const c of cases) {
    for (const t of c.tests) {
      const inferred = inferPolarity(t.observation, t);
      if (t.discriminates.length > 0) {
        const next = inferred === 'neutral' ? 'supports' : inferred;
        if (t.polarity !== next) {
          t.polarity = next;
          updated++;
        }
      } else if (!t.polarity) {
        t.polarity = 'neutral';
      }
    }
  }

  writeFileSync(pilotPath, cases.map((c) => JSON.stringify(c)).join('\n') + '\n');
  console.log(`Updated polarity on ${updated} tests across ${cases.length} cases`);
}

main();
