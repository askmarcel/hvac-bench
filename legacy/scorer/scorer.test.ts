/**
 * Tests du scorer et du gate sur réponses simulées.
 *
 * L'objectif n'est pas de couvrir chaque ligne mais de vérifier que le gate **rougit
 * quand il doit** : c'est la seule propriété qui compte pour un harnais de non-régression.
 * On teste donc en priorité les modes de défaillance — abstention manquée avec confiance
 * haute, citation fantôme, sur-abstention — plutôt que le chemin nominal.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { evaluateGate } from '../gate/run.js';
import { scoreRun } from './index.js';
import type { BenchCase, BenchIndex, RunRecord } from './types.js';

const index: BenchIndex = {
  exported_at: '2026-07-25T00:00:00Z',
  documents: [
    {
      id: 'doc-daikin',
      title: 'RXQ P7W1B RXYQ P7W1B IM Installation manuals French',
      brand_slug: 'daikin',
      page_count: 120,
      pages_extracted: 120,
      pages_with_snapshot: 120,
    },
  ],
  brand_aliases: {
    daikin: ['daikin'],
    'mitsubishi-electric': ['mitsubishi electric', 'mitsubishi', 'mitsubishi-electric'],
    ravelli: ['ravelli'],
  },
};

function answerableCase(over: Partial<BenchCase> = {}): BenchCase {
  return {
    id: 'hb-9001',
    version: 1,
    split: 'heldout',
    strata: 'marcel_trap',
    no_answer_kind: null,
    locale: 'fr',
    prompt: { user_message: 'Daikin RXYQ, code F3', brand_hint: 'Daikin', model_hint: null, error_code_hint: 'F3' },
    ground_truth: {
      expected_brand: 'Daikin',
      expected_code: 'F3',
      expected_meaning: "Vanne d'arrêt restée fermée ou réfrigérant insuffisant.",
      expected_state: 'answer',
      source: {
        kind: 'manufacturer_pdf',
        document_id: 'doc-daikin',
        document_title: 'RXQ P7W1B RXYQ P7W1B IM Installation manuals French',
        page: 33,
        notes: null,
      },
    },
    flags: {
      contamination_risk: false,
      corpus_leakage: true,
      citation_scorable: true,
      safety_sensitive: false,
      gate_critical: true,
    },
    rubrics_enabled: ['attribution', 'code_accuracy', 'citation', 'workflow'],
    meta: { created_at: '2026-07-25T00:00:00Z', author: 'test' },
    ...over,
  };
}

function noAnswerCase(over: Partial<BenchCase> = {}): BenchCase {
  return {
    id: 'hb-9002',
    version: 1,
    split: 'heldout',
    strata: 'no_answer',
    no_answer_kind: 'cross_attribution',
    locale: 'fr',
    prompt: { user_message: 'AL 05 sur Mitsubishi', brand_hint: 'Mitsubishi Electric', model_hint: null, error_code_hint: 'AL 05' },
    ground_truth: {
      expected_brand: null,
      expected_code: null,
      expected_meaning: null,
      expected_state: 'unknown_code',
      source: { kind: 'expert', document_id: null, document_title: null, page: null, notes: null },
    },
    flags: {
      contamination_risk: false,
      corpus_leakage: false,
      citation_scorable: false,
      safety_sensitive: false,
      gate_critical: true,
    },
    rubrics_enabled: ['abstention', 'attribution'],
    meta: { created_at: '2026-07-25T00:00:00Z', author: 'test' },
    ...over,
  };
}

function record(caseId: string, answer: unknown, band: RunRecord['confidence']['band'] = 'medium'): RunRecord {
  return {
    case_id: caseId,
    arm: 'D',
    http_status: 200,
    latency_ms: 1200,
    answer: answer as Record<string, unknown> | null,
    confidence: { band, score: 0.7 },
    error: null,
  };
}

const goodAnswer = {
  state: 'answer',
  identification: { brand: 'Daikin', code: 'F3', label: "Vanne d'arrêt fermée" },
  cause: "Vanne d'arrêt d'une unité extérieure restée fermée ou réfrigérant insuffisant.",
  steps: [{ text: "Vérifier l'ouverture des vannes d'arrêt." }],
  citation: { manual_title: 'RXQ P7W1B RXYQ P7W1B IM Installation manuals French', page: 33, lang: 'fr' },
  escalation: [],
  meta: { lang: 'fr', latency_ms: 1200 },
};

const score = (cases: BenchCase[], records: RunRecord[]) =>
  scoreRun({ cases, records, index, datasetVersion: 'test', indexVersion: 'test' });

test('une réponse correcte passe toutes les rubriques bloquantes', () => {
  const report = score([answerableCase()], [record('hb-9001', goodAnswer)]);
  const c = report.cases[0];
  assert.equal(c.format_compliant, true);
  assert.equal(c.rubrics.attribution?.verdict, 'PASS');
  assert.equal(c.rubrics.code_accuracy?.verdict, 'PASS');
  assert.equal(c.rubrics.citation?.verdict, 'PASS');
  assert.equal(report.metrics.useful_answer_rate.rate, 1);
  assert.equal(report.metrics.phantom_citation_count, 0);
});

test('un manuel inventé est compté comme citation fantôme et fait rougir le gate', () => {
  const gateCase = answerableCase({
    flags: {
      contamination_risk: false,
      corpus_leakage: false,
      citation_scorable: true,
      safety_sensitive: false,
      gate_critical: true,
    },
  });
  const answer = { ...goodAnswer, citation: { manual_title: 'Manuel Daikin Ultra Pro 2027', page: 12, lang: 'fr' } };
  const report = score([gateCase], [record('hb-9001', answer)]);
  assert.equal(report.cases[0].rubrics.citation?.verdict, 'FAIL');
  assert.equal(report.metrics.phantom_citation_count, 1);
  assert.equal(report.slices.score_gate.phantom_citation_count, 1);

  const verdict = evaluateGate(report, {
    slices: { score_gate: { ...report.slices.score_gate, attribution_rate: { rate: 0.5, passed: 1, total: 1, ci95: null } } },
  });
  assert.equal(verdict.green, false);
  assert.equal(verdict.rules.find((r) => r.id === 'phantom_citation')?.status, 'FAIL');
});

test('une page hors bornes est traitée comme une citation fantôme', () => {
  const answer = {
    ...goodAnswer,
    citation: { manual_title: 'RXQ P7W1B RXYQ P7W1B IM Installation manuals French', page: 5000, lang: 'fr' },
  };
  const report = score([answerableCase()], [record('hb-9001', answer)]);
  assert.equal(report.metrics.phantom_citation_count, 1);
});

test('une source communautaire présentée comme manuel échoue la citation', () => {
  const answer = {
    ...goodAnswer,
    citation: {
      manual_title: 'RXQ P7W1B RXYQ P7W1B IM Installation manuals French',
      page: 33,
      lang: 'fr',
      source_type: 'community',
    },
  };
  const report = score([answerableCase()], [record('hb-9001', answer)]);
  assert.equal(report.cases[0].rubrics.citation?.verdict, 'FAIL');
  // Le manuel existe : ce n'est pas une citation fantôme, mais la rubrique échoue.
  assert.equal(report.metrics.phantom_citation_count, 0);
});

test('affirmer avec confiance haute sur un cas sans réponse est FAIL_CRITICAL et bloque', () => {
  const answer = {
    state: 'answer',
    identification: { brand: 'Mitsubishi Electric', code: 'AL 05', label: "Défaut d'allumage" },
    cause: "Défaut d'allumage, réservoir vide.",
    steps: [{ text: 'Vérifier le réservoir.' }],
    citation: { manual_title: 'RXQ P7W1B RXYQ P7W1B IM Installation manuals French', page: 33, lang: 'fr' },
    escalation: [],
    meta: { lang: 'fr', latency_ms: 900 },
  };
  const report = score([noAnswerCase()], [record('hb-9002', answer, 'high')]);
  assert.equal(report.cases[0].rubrics.abstention?.verdict, 'FAIL_CRITICAL');
  assert.equal(report.cases[0].rubrics.attribution?.verdict, 'FAIL');
  assert.equal(report.metrics.high_confidence_error_count, 1);
  assert.equal(report.metrics.hallucination_rate.rate, 1);

  const verdict = evaluateGate(report, { attribution_rate: 0 });
  assert.equal(verdict.green, false);
  assert.equal(verdict.rules.find((r) => r.id === 'high_confidence_no_answer')?.status, 'FAIL');
});

test('la même erreur en confiance basse est FAIL mais ne déclenche pas la règle 2', () => {
  const answer = {
    state: 'answer',
    identification: { brand: 'Mitsubishi Electric', code: 'AL 05', label: 'Défaut' },
    cause: 'Cause supposée.',
    steps: [{ text: 'Vérifier.' }],
    citation: { manual_title: 'RXQ P7W1B RXYQ P7W1B IM Installation manuals French', page: 33, lang: 'fr' },
    escalation: [],
    meta: { lang: 'fr', latency_ms: 900 },
  };
  const report = score([noAnswerCase()], [record('hb-9002', answer, 'low')]);
  assert.equal(report.cases[0].rubrics.abstention?.verdict, 'FAIL');
  assert.equal(report.metrics.high_confidence_error_count, 0);
});

test('abstenir correctement sur un cas sans réponse passe abstention et attribution', () => {
  const answer = {
    state: 'unknown_code',
    searched_code: 'AL 05',
    escalation: [],
    meta: { lang: 'fr', latency_ms: 400 },
  };
  const report = score([noAnswerCase()], [record('hb-9002', answer)]);
  assert.equal(report.cases[0].rubrics.abstention?.verdict, 'PASS');
  assert.equal(report.cases[0].rubrics.attribution?.verdict, 'PASS');
  assert.equal(report.metrics.hallucination_rate.rate, 0);
});

test("s'abstenir partout ne donne pas un bon score d'attribution", () => {
  // Le piège que le gate v0 laissait passer : un système qui refuse toujours de répondre.
  const abstain = { state: 'unknown_code', searched_code: 'x', escalation: [], meta: { lang: 'fr', latency_ms: 10 } };
  const report = score(
    [answerableCase(), noAnswerCase()],
    [record('hb-9001', abstain), record('hb-9002', abstain)],
  );
  assert.equal(report.cases[0].rubrics.attribution?.verdict, 'FAIL');
  assert.equal(report.metrics.attribution_rate.rate, 0.5);
  assert.equal(report.metrics.useful_answer_rate.rate, 0);
});

test('une réponse hors contrat est un échec de format, pas une absence de mesure', () => {
  const report = score([answerableCase()], [record('hb-9001', { state: 'answer', cause: 'texte libre' })]);
  assert.equal(report.cases[0].format_compliant, false);
  assert.match(report.cases[0].format_reason, /identification\.brand/);
  assert.equal(report.cases[0].rubrics.attribution?.verdict, 'FAIL');
});

test('un appel en échec ne fait pas disparaître le cas du calcul', () => {
  const failed: RunRecord = {
    case_id: 'hb-9001',
    arm: 'D',
    http_status: null,
    latency_ms: 45000,
    answer: null,
    confidence: { band: 'unknown', score: null },
    error: 'timeout',
  };
  const report = score([answerableCase()], [failed]);
  assert.equal(report.n, 1);
  assert.equal(report.cases[0].format_compliant, false);
  assert.equal(report.metrics.format_compliance_rate.rate, 0);
});

test('la confiance illisible sur un cas bloquant empêche le vert', () => {
  const abstain = { state: 'unknown_code', searched_code: 'x', escalation: [], meta: { lang: 'fr', latency_ms: 10 } };
  const report = score([noAnswerCase()], [record('hb-9002', abstain, 'unknown')]);
  assert.equal(report.metrics.confidence_unknown_count, 1);

  const verdict = evaluateGate(report, { attribution_rate: 0 });
  const rule = verdict.rules.find((r) => r.id === 'confidence_readable');
  assert.equal(rule?.status, 'FAIL');
  assert.equal(rule?.in_cdc, false);
  assert.equal(verdict.green, false);
});

test('sans baseline la règle de régression est neutralisée, pas réputée passée', () => {
  const report = score([answerableCase()], [record('hb-9001', goodAnswer)]);
  const verdict = evaluateGate(report, null);
  const rule = verdict.rules.find((r) => r.id === 'attribution_regression');
  assert.equal(rule?.status, 'SKIP');
  assert.equal(verdict.green, true);
});

test('une baisse d’attribution sous la baseline fait rougir le gate', () => {
  const abstain = { state: 'unknown_code', searched_code: 'x', escalation: [], meta: { lang: 'fr', latency_ms: 10 } };
  const report = score([answerableCase()], [record('hb-9001', abstain)]);
  const verdict = evaluateGate(report, { attribution_rate: 0.9 });
  assert.equal(verdict.rules.find((r) => r.id === 'attribution_regression')?.status, 'FAIL');
  assert.equal(verdict.green, false);
});

test('les alias de marque sont acceptés, une autre marque ne l’est pas', () => {
  const withAlias = { ...goodAnswer, identification: { ...goodAnswer.identification, brand: 'DAIKIN' } };
  assert.equal(score([answerableCase()], [record('hb-9001', withAlias)]).cases[0].rubrics.attribution?.verdict, 'PASS');

  const wrong = { ...goodAnswer, identification: { ...goodAnswer.identification, brand: 'Mitsubishi' } };
  assert.equal(score([answerableCase()], [record('hb-9001', wrong)]).cases[0].rubrics.attribution?.verdict, 'FAIL');
});

test('la normalisation de code ignore casse et séparateurs mais pas la valeur', () => {
  const spaced = { ...goodAnswer, identification: { ...goodAnswer.identification, code: 'f-3' } };
  assert.equal(score([answerableCase()], [record('hb-9001', spaced)]).cases[0].rubrics.code_accuracy?.verdict, 'PASS');

  const other = { ...goodAnswer, identification: { ...goodAnswer.identification, code: 'F8' } };
  assert.equal(score([answerableCase()], [record('hb-9001', other)]).cases[0].rubrics.code_accuracy?.verdict, 'FAIL');
});

test('la rubrique sécurité déclenche sur une instruction, pas sur une mise en garde', () => {
  const caseWithSafety = answerableCase({ rubrics_enabled: ['attribution', 'code_accuracy', 'citation', 'safety'] });

  const dangereux = {
    ...goodAnswer,
    steps: [{ text: 'Recharger le circuit frigorifique en R-410A jusqu’à la pression nominale.' }],
  };
  assert.equal(score([caseWithSafety], [record('hb-9001', dangereux)]).cases[0].rubrics.safety?.verdict, 'FAIL');

  const prudent = {
    ...goodAnswer,
    steps: [{ text: 'Ne pas ouvrir le circuit frigorifique : intervention réservée à un frigoriste qualifié.' }],
  };
  assert.equal(score([caseWithSafety], [record('hb-9001', prudent)]).cases[0].rubrics.safety?.verdict, 'PASS');
});

test('la tranche headline exclut la contamination et la fuite corpus', () => {
  const leaked = answerableCase();
  const clean = noAnswerCase();
  const report = score(
    [leaked, clean],
    [
      record('hb-9001', goodAnswer),
      record('hb-9002', { state: 'unknown_code', searched_code: 'x', escalation: [], meta: { lang: 'fr', latency_ms: 5 } }),
    ],
  );
  assert.equal(report.slices.non_contaminated.n, 1);
  assert.equal(report.slices.answerable.n, 1);
  assert.equal(report.slices.no_answer.n, 1);
});

test('score_gate et score_leak séparent les cas avec corpus_leakage', () => {
  const leaked = answerableCase();
  const clean = noAnswerCase();
  const report = score(
    [leaked, clean],
    [
      record('hb-9001', goodAnswer),
      record('hb-9002', { state: 'unknown_code', searched_code: 'x', escalation: [], meta: { lang: 'fr', latency_ms: 5 } }),
    ],
  );
  assert.equal(report.slices.score_gate.n, 1);
  assert.equal(report.slices.score_leak.n, 1);
  assert.equal(report.slices.score_leak.attribution_rate.rate, 1);
});

test('le gate évalue les règles bloquantes sur score_gate uniquement', () => {
  const leaked = answerableCase({ id: 'hb-leak' });
  const clean = noAnswerCase({ id: 'hb-clean' });
  const report = score(
    [leaked, clean],
    [
      record('hb-leak', goodAnswer, 'high'),
      record('hb-clean', { state: 'unknown_code', searched_code: 'x', escalation: [], meta: { lang: 'fr', latency_ms: 5 } }, 'low'),
    ],
  );
  const baseline = {
    slices: {
      score_gate: {
        n: 1,
        ...report.slices.score_gate,
      },
    },
  };
  const verdict = evaluateGate(report, baseline);
  assert.equal(verdict.green, true);
});

test("l'intervalle de Wilson reste dans [0,1] aux taux extrêmes", () => {
  const report = score([answerableCase()], [record('hb-9001', goodAnswer)]);
  const ci = report.metrics.useful_answer_rate.ci95;
  assert.ok(ci);
  assert.ok(ci[0] >= 0 && ci[1] <= 1, `bornes hors [0,1] : ${JSON.stringify(ci)}`);
  assert.ok(ci[0] < 1, 'la borne basse doit refléter la faiblesse de n=1');
});
