/**
 * Agrège les annotations workflow Phase 4 (hors gate, score secondaire).
 *
 * Usage :
 *   pnpm exec tsx scripts/score-workflow.ts --in workflow/phase4-annotations.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

type AnnotationRow = {
  case_id: string;
  ordre_simple_invasif: number | null;
  coherence_metier: number | null;
  completude: number | null;
  notes?: string;
  annotator?: string;
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2));
}

function main() {
  const inPath = resolve(arg('in') ?? 'workflow/phase4-annotations.json');
  const raw = JSON.parse(readFileSync(inPath, 'utf8')) as {
    cases?: AnnotationRow[];
    annotations?: AnnotationRow[];
  };
  const rows: AnnotationRow[] = raw.cases
    ? raw.cases.map((c) => ({
        case_id: c.case_id,
        ordre_simple_invasif: (c as AnnotationRow).ordre_simple_invasif,
        coherence_metier: (c as AnnotationRow).coherence_metier,
        completude: (c as AnnotationRow).completude,
      }))
    : raw.annotations ?? [];

  const scored = rows.filter(
    (r) =>
      typeof r.ordre_simple_invasif === 'number' &&
      typeof r.coherence_metier === 'number' &&
      typeof r.completude === 'number',
  );

  const report = {
    source: inPath,
    n_total: rows.length,
    n_scored: scored.length,
    means: {
      ordre_simple_invasif: mean(scored.map((r) => r.ordre_simple_invasif as number)),
      coherence_metier: mean(scored.map((r) => r.coherence_metier as number)),
      completude: mean(scored.map((r) => r.completude as number)),
      workflow_composite: mean(
        scored.map(
          (r) =>
            ((r.ordre_simple_invasif as number) +
              (r.coherence_metier as number) +
              (r.completude as number)) /
            3,
        ),
      ),
    },
    scale: '1–5 (1=insuffisant, 5=excellent)',
    note: 'Score secondaire — ne pas mélanger avec headline hallucination/utilité (CDC §4.6).',
  };

  const out = resolve(arg('out') ?? 'workflow/phase4-workflow-score.json');
  writeFileSync(out, JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report, null, 2));
  console.log(`→ ${out}`);
}

main();
