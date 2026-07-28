/**
 * Audit polarité tests — détecte incohérences observation vs étiquette déclarée.
 *
 * Usage:
 *   pnpm audit:polarity -- --cases dataset/pilot/pilot-v2.jsonl
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export type TestPolarity = 'supports' | 'refutes' | 'neutral';

type TestRow = {
  action_id: string;
  observation: string;
  discriminates: string[];
  eliminates: string[];
  polarity?: string;
};

type CaseRow = {
  id: string;
  tests?: TestRow[];
  meta?: { family?: string };
};

export function inferPolarity(observation: string): TestPolarity {
  if (/remplacement inutile|déjà fait.*inefficace|inefficace/i.test(observation)) return 'refutes';
  if (/disparait|disparaît|résolu|corrige|ne revient plus|efficace/i.test(observation)) return 'supports';
  if (/stable/i.test(observation) && /après|remplacement|remplac/i.test(observation)) return 'supports';
  if (/conforme|normal|dans la plage|ok\b|rien d.anormal/i.test(observation)) return 'refutes';
  if (/stable/i.test(observation)) return 'refutes';
  if (/anormal|hors plage|colmat|bouch|défaut|defaut|vide|insuffisant|encrass/i.test(observation)) {
    return 'supports';
  }
  return 'neutral';
}

export type PolarityFlag = {
  case_id: string;
  action_id: string;
  inferred: string;
  declared: string;
  observation: string;
  reason: string;
};

export function auditPolarityFlags(cases: CaseRow[]): PolarityFlag[] {
  const flagged: PolarityFlag[] = [];

  for (const c of cases) {
    for (const t of c.tests ?? []) {
      const inferred = inferPolarity(t.observation);
      const declared = t.polarity ?? 'supports';

      if (inferred === 'refutes' && declared !== 'refutes') {
        flagged.push({
          case_id: c.id,
          action_id: t.action_id,
          inferred,
          declared,
          observation: t.observation,
          reason: 'inferred_refutes_mismatch',
        });
      } else if (inferred === 'supports' && declared !== 'supports') {
        flagged.push({
          case_id: c.id,
          action_id: t.action_id,
          inferred,
          declared,
          observation: t.observation,
          reason: 'inferred_supports_mismatch',
        });
      } else if (inferred === 'neutral' && (declared === 'supports' || declared === 'refutes')) {
        flagged.push({
          case_id: c.id,
          action_id: t.action_id,
          inferred,
          declared,
          observation: t.observation,
          reason: 'unverified_label',
        });
      }
    }
  }

  return flagged;
}

function loadCases(paths: string[]): { cases: CaseRow[]; skipped: number; paths: string[] } {
  const cases: CaseRow[] = [];
  let skipped = 0;
  for (const p of paths) {
    const abs = resolve(p);
    const lines = readFileSync(abs, 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      const c = JSON.parse(line) as CaseRow;
      if (!Array.isArray(c.tests) || c.tests.length === 0) {
        skipped++;
        continue;
      }
      cases.push(c);
    }
  }
  return { cases, skipped, paths };
}

function main() {
  const args = process.argv.slice(2);
  const casesIdx = args.indexOf('--cases');
  const defaultPath = resolve(dirname(fileURLToPath(import.meta.url)), '../dataset/pilot/pilot-v2.jsonl');
  const casesArg = casesIdx >= 0 ? args[casesIdx + 1]! : defaultPath;
  const casePaths = casesArg.split(',').map((p) => p.trim()).filter(Boolean);

  const { cases, skipped, paths } = loadCases(casePaths);
  const flagged = auditPolarityFlags(cases);

  const report = {
    audited_at: new Date().toISOString(),
    cases_paths: paths,
    cases_diagnostic: cases.length,
    cases_skipped_no_tests: skipped,
    tests: cases.reduce((n, c) => n + (c.tests?.length ?? 0), 0),
    flagged_count: flagged.length,
    flagged,
    note:
      skipped > 0
        ? 'Les cas publics bench-v2 (Q&A) n ont pas de tests[] — polarité auditée uniquement sur corpus diagnostic.'
        : undefined,
  };

  const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '../reports');
  writeFileSync(
    resolve(outDir, `audit-polarity-${new Date().toISOString().slice(0, 10)}.json`),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(JSON.stringify(report, null, 2));

  if (flagged.length > 0) {
    process.exit(1);
  }
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(dirname(fileURLToPath(import.meta.url)), 'audit-polarity.ts');

if (isMain) {
  main();
}
