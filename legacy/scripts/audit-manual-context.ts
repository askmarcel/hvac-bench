/**
 * Audit manual_context — provenance et recouvrement gate.
 * Usage: pnpm exec tsx scripts/audit-manual-context.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

type CaseRow = {
  id: string;
  manual_context?: {
    document_id: string | null;
    page?: number;
    excerpt?: string;
    title?: string;
  } | null;
};

function main() {
  const pilotPath = resolve(dirname(fileURLToPath(import.meta.url)), '../dataset/pilot/pilot-v2.jsonl');
  const cases: CaseRow[] = readFileSync(pilotPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as CaseRow);

  const missingDocId = cases.filter((c) => c.manual_context?.excerpt && !c.manual_context?.document_id);
  const withContext = cases.filter((c) => c.manual_context?.excerpt);

  const report = {
    audited_at: new Date().toISOString(),
    cases: cases.length,
    with_manual_context: withContext.length,
    missing_document_id: missingDocId.map((c) => ({
      case_id: c.id,
      title: c.manual_context?.title,
      excerpt_preview: c.manual_context?.excerpt?.slice(0, 80),
    })),
    hb2_0009_note: 'Vérifier extrait Grundfos hors sujet (audit)',
  };

  const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '../reports');
  writeFileSync(
    resolve(outDir, `audit-manual-context-${new Date().toISOString().slice(0, 10)}.json`),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(JSON.stringify(report, null, 2));
}

main();
