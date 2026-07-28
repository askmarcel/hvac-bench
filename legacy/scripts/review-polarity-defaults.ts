/**
 * Revue des étiquettes polarity par défaut (unverified_label) — crible contrefactuel hb2-0010.
 *
 * Usage: pnpm review:polarity-defaults
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { auditPolarityFlags, inferPolarity, type PolarityFlag } from './audit-polarity.js';

type TestRow = {
  action_id: string;
  observation: string;
  discriminates: string[];
  eliminates: string[];
  polarity?: string;
  resolves?: boolean;
};

type CaseRow = { id: string; tests?: TestRow[]; meta?: { family?: string } };

/** Règles contrefactuelles (alignées migrate-polarity-pilot). */
export function inferPolarityContrefactual(
  observation: string,
  test?: Pick<TestRow, 'discriminates' | 'resolves'>,
): 'supports' | 'refutes' | 'neutral' {
  if (test?.resolves && (test.discriminates?.length ?? 0) > 0) {
    if (
      /rétabli|rétablissement|disparait|disparaît|ne revient plus|efficace|corrigé|corrige/i.test(
        observation,
      )
    ) {
      return 'supports';
    }
    if (/stable/i.test(observation) && /après|remplacement|remplac/i.test(observation)) {
      return 'supports';
    }
  }
  if (/remplacement inutile|déjà fait.*inefficace|inefficace/i.test(observation)) {
    return 'refutes';
  }
  return inferPolarity(observation);
}

export type PolarityReviewVerdict = {
  case_id: string;
  action_id: string;
  observation: string;
  declared: string;
  regex_inferred: string;
  contrefactual_inferred: string;
  verdict: 'ok_default' | 'fix_to_contrefactual' | 'review_manual';
  reason: string;
};

export function reviewUnverifiedLabels(cases: CaseRow[]): PolarityReviewVerdict[] {
  const flags = auditPolarityFlags(cases).filter((f) => f.reason === 'unverified_label');
  const out: PolarityReviewVerdict[] = [];

  for (const f of flags) {
    const c = cases.find((x) => x.id === f.case_id);
    const t = c?.tests?.find((x) => x.action_id === f.action_id);
    const cont = inferPolarityContrefactual(f.observation, t);
    const declared = f.declared;

    let verdict: PolarityReviewVerdict['verdict'] = 'ok_default';
    let reason = 'Observation anormale / contexte expert — supports par défaut cohérent';

    if (cont !== 'neutral' && cont !== declared) {
      verdict = 'fix_to_contrefactual';
      reason = `Contrefactuel → ${cont}, déclaré ${declared}`;
    } else if (/conforme|stable|normal/i.test(f.observation) && declared === 'supports') {
      verdict = 'review_manual';
      reason = 'Mot conformité/stable + supports — vérifier contexte (confirmation vs négation)';
    }

    out.push({
      case_id: f.case_id,
      action_id: f.action_id,
      observation: f.observation,
      declared,
      regex_inferred: f.inferred,
      contrefactual_inferred: cont,
      verdict,
      reason,
    });
  }

  return out;
}

function main() {
  const pilotPath = resolve(import.meta.dirname, '../dataset/pilot/pilot-v2.jsonl');
  const cases: CaseRow[] = readFileSync(pilotPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as CaseRow);

  const reviews = reviewUnverifiedLabels(cases);
  const mismatches = auditPolarityFlags(cases).filter((f) => f.reason !== 'unverified_label');

  const report = {
    generated_at: new Date().toISOString(),
    n_unverified: reviews.length,
    n_ok_default: reviews.filter((r) => r.verdict === 'ok_default').length,
    n_fix_contrefactual: reviews.filter((r) => r.verdict === 'fix_to_contrefactual').length,
    n_review_manual: reviews.filter((r) => r.verdict === 'review_manual').length,
    unverified_reviews: reviews,
    inferred_mismatches: mismatches,
    fixes_applied: [] as PolarityFlag[],
  };

  let pilotChanged = 0;
  for (const r of reviews) {
    if (r.verdict !== 'fix_to_contrefactual') continue;
    const c = cases.find((x) => x.id === r.case_id);
    const t = c?.tests?.find((x) => x.action_id === r.action_id);
    if (t && t.polarity !== r.contrefactual_inferred) {
      t.polarity = r.contrefactual_inferred as 'supports' | 'refutes' | 'neutral';
      pilotChanged++;
      report.fixes_applied.push({
        case_id: r.case_id,
        action_id: r.action_id,
        inferred: r.contrefactual_inferred,
        declared: r.declared,
        observation: r.observation,
        reason: 'contrefactual_fix',
      });
    }
  }

  // Corrige aussi les inferred_*_mismatch évidents (conforme / inutile → refutes)
  for (const f of mismatches) {
    const c = cases.find((x) => x.id === f.case_id);
    const t = c?.tests?.find((x) => x.action_id === f.action_id);
    if (!t) continue;
    const cont = inferPolarityContrefactual(f.observation, t);
    if (cont !== 'neutral' && cont !== (t.polarity ?? 'supports')) {
      const prev = t.polarity;
      t.polarity = cont;
      pilotChanged++;
      report.fixes_applied.push({ ...f, declared: prev ?? 'supports', reason: 'mismatch_contrefactual_fix' });
    }
  }

  if (pilotChanged > 0) {
    writeFileSync(pilotPath, cases.map((c) => JSON.stringify(c)).join('\n') + '\n');
  }

  const reportsDir = resolve(import.meta.dirname, '../reports');
  mkdirSync(reportsDir, { recursive: true });
  const outPath = resolve(reportsDir, 'polarity-defaults-review-2026-07-26.json');
  writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');

  console.log(`unverified_label: ${report.n_unverified}`);
  console.log(`  ok_default: ${report.n_ok_default}`);
  console.log(`  fix_contrefactual: ${report.n_fix_contrefactual}`);
  console.log(`  review_manual: ${report.n_review_manual}`);
  console.log(`inferred_mismatches: ${mismatches.length}`);
  console.log(`fixes pilot: ${pilotChanged}`);
  console.log(`Rapport: ${outPath}`);

  if (report.n_review_manual > 0) {
    console.log('\nRevue manuelle suggérée:');
    for (const r of reviews.filter((x) => x.verdict === 'review_manual')) {
      console.log(`  ${r.case_id}/${r.action_id}: ${r.observation.slice(0, 60)}…`);
    }
  }
}

main();
