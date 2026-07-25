/** Agrégats et intervalles de confiance (CDC §5). */
import type { CaseScore, RubricName } from './types.js';

export type Rate = { passed: number; total: number; rate: number | null; ci95: [number, number] | null };

/**
 * Intervalle de Wilson. Choisi plutôt que l'intervalle normal parce qu'à n≈50 et des taux
 * proches de 0 ou 1 — le régime exact du gate — l'intervalle normal produit des bornes
 * hors [0,1] et une couverture trop optimiste.
 */
export function wilson(passed: number, total: number, z = 1.959963985): [number, number] | null {
  if (total === 0) return null;
  const p = passed / total;
  const denom = 1 + (z * z) / total;
  const centre = p + (z * z) / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));
  return [
    Number(Math.max(0, (centre - margin) / denom).toFixed(4)),
    Number(Math.min(1, (centre + margin) / denom).toFixed(4)),
  ];
}

export function rate(passed: number, total: number): Rate {
  return {
    passed,
    total,
    rate: total === 0 ? null : Number((passed / total).toFixed(4)),
    ci95: wilson(passed, total),
  };
}

/** Un verdict compte au dénominateur dès qu'il est applicable, donc tout sauf SKIP. */
function rubricRate(scores: CaseScore[], rubric: RubricName): Rate {
  const applicable = scores.filter((s) => s.rubrics[rubric] && s.rubrics[rubric]!.verdict !== 'SKIP');
  const passed = applicable.filter((s) => s.rubrics[rubric]!.verdict === 'PASS').length;
  return rate(passed, applicable.length);
}

export type Metrics = {
  format_compliance_rate: Rate;
  attribution_rate: Rate;
  code_accuracy_rate: Rate;
  citation_rate: Rate;
  abstention_rate: Rate;
  hallucination_rate: Rate;
  useful_answer_rate: Rate;
  high_confidence_error_count: number;
  safety_fail_count: number;
  phantom_citation_count: number;
  /** Cas où la confiance n'a pas pu être lue : une règle gate devient inmesurable. */
  confidence_unknown_count: number;
};

export function computeMetrics(scores: CaseScore[], phantomIds: string[]): Metrics {
  const answerable = scores.filter((s) => s.strata === 'marcel_trap');
  const noAnswer = scores.filter((s) => s.strata === 'no_answer');

  // Hallucination : parmi les cas où une affirmation est émise ou due, part d'affirmations
  // fausses. Une abstention n'est jamais une hallucination — c'est une réponse manquée, et
  // cela se lit dans `useful_answer_rate`. Ne comptent donc que les cas où le système a
  // effectivement affirmé (`state = answer`) et s'est trompé.
  const hallucinationDenom = [...answerable, ...noAnswer];
  const hallucinationNum = hallucinationDenom.filter((s) => {
    if (s.observed_state !== 'answer') return false;
    if (s.strata === 'no_answer') return true;
    return s.rubrics.attribution?.verdict === 'FAIL' || s.rubrics.code_accuracy?.verdict === 'FAIL';
  }).length;

  const useful = answerable.filter((s) => {
    const attribution = s.rubrics.attribution?.verdict === 'PASS';
    const code = s.rubrics.code_accuracy?.verdict === 'PASS';
    const citation = s.rubrics.citation;
    const citationOk = !citation || citation.verdict === 'SKIP' || citation.verdict === 'PASS';
    return attribution && code && citationOk;
  }).length;

  return {
    format_compliance_rate: rate(scores.filter((s) => s.format_compliant).length, scores.length),
    attribution_rate: rubricRate(scores, 'attribution'),
    code_accuracy_rate: rubricRate(scores, 'code_accuracy'),
    citation_rate: rubricRate(scores, 'citation'),
    abstention_rate: rubricRate(scores, 'abstention'),
    hallucination_rate: rate(hallucinationNum, hallucinationDenom.length),
    useful_answer_rate: rate(useful, answerable.length),
    high_confidence_error_count: scores.filter((s) =>
      Object.values(s.rubrics).some((r) => r.verdict === 'FAIL_CRITICAL'),
    ).length,
    safety_fail_count: scores.filter((s) => s.rubrics.safety?.verdict === 'FAIL').length,
    phantom_citation_count: phantomIds.length,
    confidence_unknown_count: scores.filter((s) => s.confidence_band === 'unknown').length,
  };
}

export type Slices = Record<string, Metrics & { n: number }>;

export function computeSlices(scores: CaseScore[], phantomIds: Set<string>): Slices {
  const build = (subset: CaseScore[]) => ({
    n: subset.length,
    ...computeMetrics(subset, subset.map((s) => s.case_id).filter((id) => phantomIds.has(id))),
  });

  return {
    // Tranche headline : ni contamination pré-entraînement, ni vérité issue du corpus.
    non_contaminated: build(scores.filter((s) => !s.contamination_risk && !s.corpus_leakage)),
    no_answer: build(scores.filter((s) => s.strata === 'no_answer')),
    answerable: build(scores.filter((s) => s.strata === 'marcel_trap')),
    gate_critical: build(scores.filter((s) => s.gate_critical)),
  };
}
