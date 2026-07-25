/**
 * Gate CI — applique les règles bloquantes du CDC §7 REQ-G2 à un rapport de score.
 *
 * Usage :
 *   tsx gate/run.ts --score runs/<run_id>/score.json [--baseline baselines/last-green.json]
 *                   [--epsilon 0]
 *
 * Rouge si l'une des conditions est vraie (évaluées sur la tranche score_gate, hors corpus_leakage) :
 *   1. régression attribution : attribution_rate < baseline − ε
 *   2. high_confidence_no_answer_fail_count ≥ 1
 *   3. phantom_citation_count ≥ 1
 *
 * S'y ajoute une quatrième condition, hors CDC et signalée comme telle : si la confiance
 * n'a pas pu être lue sur un cas no-answer bloquant, la règle 2 ne mesure rien sur ce cas.
 * Un gate incapable d'évaluer sa propre règle ne peut pas être déclaré vert.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { ScoreReport } from '../scorer/index.js';
import type { CaseScore } from '../scorer/types.js';
import type { Metrics } from '../scorer/aggregate.js';

type RateRef = { rate: number | null };
type SliceRef = Metrics & { n: number };

type Baseline = {
  attribution_rate?: number | RateRef;
  run_id?: string;
  dataset_version?: string;
  slices?: {
    score_gate?: SliceRef;
  };
};

export type GateRule = {
  id: string;
  label: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  detail: string;
  blocking: boolean;
  in_cdc: boolean;
};

export type GateVerdict = { green: boolean; rules: GateRule[] };

function isGateCase(c: CaseScore): boolean {
  return !c.corpus_leakage;
}

function gateSlice(report: ScoreReport): SliceRef | undefined {
  return report.slices.score_gate;
}

function baselineAttribution(baseline: Baseline | null): number | null {
  if (!baseline) return null;
  const sliceRate = baseline.slices?.score_gate?.attribution_rate?.rate;
  if (typeof sliceRate === 'number') return sliceRate;
  const value = baseline.attribution_rate;
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object' && typeof value.rate === 'number') return value.rate;
  return null;
}

export function evaluateGate(
  report: ScoreReport,
  baseline: Baseline | null,
  epsilon = 0,
): GateVerdict {
  const rules: GateRule[] = [];
  const gateCases = report.cases.filter(isGateCase);
  const gateMetrics = gateSlice(report);
  const gateN = gateMetrics?.n ?? gateCases.length;

  // Règle 1 — régression attribution (tranche score_gate).
  const observed = gateMetrics?.attribution_rate.rate ?? null;
  const reference = baselineAttribution(baseline);
  if (reference === null) {
    rules.push({
      id: 'attribution_regression',
      label: 'Régression attribution (score_gate)',
      status: 'SKIP',
      detail:
        "aucune baseline score_gate exploitable — premier run ou baseline à régénérer. La règle ne peut pas s'appliquer (REQ-G3).",
      blocking: false,
      in_cdc: true,
    });
  } else if (observed === null) {
    rules.push({
      id: 'attribution_regression',
      label: 'Régression attribution (score_gate)',
      status: 'FAIL',
      detail: 'aucun cas score_gate ne porte la rubrique attribution : le taux est inmesurable.',
      blocking: true,
      in_cdc: true,
    });
  } else {
    const regressed = observed < reference - epsilon;
    rules.push({
      id: 'attribution_regression',
      label: 'Régression attribution (score_gate)',
      status: regressed ? 'FAIL' : 'PASS',
      detail: `${(observed * 100).toFixed(1)} % contre ${(reference * 100).toFixed(1)} % de référence sur ${gateN} cas (ε = ${epsilon}).`,
      blocking: regressed,
      in_cdc: true,
    });
  }

  // Règle 2 — réponse affirmée avec confiance haute sur un cas sans réponse attendue.
  const criticalCases = gateCases.filter(
    (c) => c.strata === 'no_answer' && c.rubrics.abstention?.verdict === 'FAIL_CRITICAL',
  );
  rules.push({
    id: 'high_confidence_no_answer',
    label: 'Confiance haute sur cas sans réponse',
    status: criticalCases.length > 0 ? 'FAIL' : 'PASS',
    detail:
      criticalCases.length > 0
        ? `${criticalCases.length} cas : ${criticalCases.map((c) => c.case_id).join(', ')}`
        : 'aucun cas.',
    blocking: criticalCases.length > 0,
    in_cdc: true,
  });

  // Règle 3 — citation fantôme (score_gate).
  const phantoms = gateCases.filter(
    (c) =>
      c.rubrics.citation?.reason.includes('introuvable') ||
      c.rubrics.citation?.reason.includes('hors bornes'),
  );
  const phantomCount = gateMetrics?.phantom_citation_count ?? phantoms.length;
  rules.push({
    id: 'phantom_citation',
    label: 'Citation fantôme',
    status: phantomCount > 0 ? 'FAIL' : 'PASS',
    detail:
      phantomCount > 0
        ? `${phantomCount} cas : ${phantoms.map((c) => c.case_id).join(', ')}`
        : 'aucune citation non résolue.',
    blocking: phantomCount > 0,
    in_cdc: true,
  });

  // Règle 4 — hors CDC : mesurabilité de la règle 2.
  const unmeasurable = gateCases.filter(
    (c) => c.strata === 'no_answer' && c.gate_critical && c.confidence_band === 'unknown',
  );
  rules.push({
    id: 'confidence_readable',
    label: 'Confiance lisible sur les cas bloquants',
    status: unmeasurable.length > 0 ? 'FAIL' : 'PASS',
    detail:
      unmeasurable.length > 0
        ? `${unmeasurable.length} cas sans bande de confiance : la règle 2 ne les couvre pas (${unmeasurable
            .slice(0, 5)
            .map((c) => c.case_id)
            .join(', ')}${unmeasurable.length > 5 ? '…' : ''}).`
        : 'confiance lue sur tous les cas bloquants.',
    blocking: unmeasurable.length > 0,
    in_cdc: false,
  });

  return { green: rules.every((r) => !r.blocking), rules };
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main() {
  const scorePath = resolve(arg('score') ?? 'runs/score.json');
  const baselinePath = resolve(arg('baseline') ?? 'baselines/last-green.json');
  const epsilon = Number(arg('epsilon') ?? 0);

  const report = JSON.parse(readFileSync(scorePath, 'utf8')) as ScoreReport;
  const baseline = existsSync(baselinePath)
    ? (JSON.parse(readFileSync(baselinePath, 'utf8')) as Baseline)
    : null;

  const verdict = evaluateGate(report, baseline, epsilon);
  const gateN = report.slices.score_gate?.n ?? report.cases.filter((c) => !c.corpus_leakage).length;
  const leakN = report.slices.score_leak?.n ?? report.cases.filter((c) => c.corpus_leakage).length;

  console.log(`\nGate HVAC Bench — bras ${report.arm} · run ${report.run_id} · ${report.n} cas`);
  console.log(`  score_gate ${gateN} cas · score_leak ${leakN} cas (signal, non bloquant)\n`);
  for (const rule of verdict.rules) {
    const mark = rule.status === 'PASS' ? '✓' : rule.status === 'SKIP' ? '–' : '✗';
    const origin = rule.in_cdc ? '' : ' (hors CDC)';
    console.log(`  ${mark} ${rule.label}${origin}\n      ${rule.detail}`);
  }
  console.log(`\n  ${verdict.green ? 'VERT' : 'ROUGE'}\n`);

  process.exit(verdict.green ? 0 : 1);
}

if (process.argv[1] && process.argv[1].endsWith('run.ts')) {
  main();
}
