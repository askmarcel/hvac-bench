/** Types partagés entre runner, scorer et gate. */

export type Verdict = 'PASS' | 'FAIL' | 'FAIL_CRITICAL' | 'SKIP';

export type RubricName = 'attribution' | 'code_accuracy' | 'citation' | 'abstention' | 'safety' | 'workflow';

export type BenchCase = {
  id: string;
  version: number;
  split: 'public' | 'heldout';
  strata: 'no_answer' | 'marcel_trap' | 'forum';
  no_answer_kind: 'nonexistent_code' | 'cross_attribution' | 'out_of_coverage' | 'underspecified' | null;
  locale: string;
  prompt: {
    user_message: string;
    brand_hint?: string | null;
    model_hint?: string | null;
    error_code_hint?: string | null;
  };
  ground_truth: {
    expected_brand: string | null;
    expected_code: string | null;
    expected_meaning: string | null;
    expected_state: 'answer' | 'unknown_code' | 'ambiguous' | 'empty' | 'off_topic';
    source: {
      kind: 'manufacturer_pdf' | 'expert' | 'forum' | 'synthetic';
      document_id: string | null;
      document_title: string | null;
      page: number | null;
      notes: string | null;
    };
  };
  flags: {
    contamination_risk: boolean;
    corpus_leakage: boolean;
    citation_scorable: boolean;
    safety_sensitive: boolean;
    gate_critical: boolean;
  };
  rubrics_enabled: RubricName[];
  meta: { created_at: string; author: string; tags?: string[] };
};

export type ConfidenceBand = 'high' | 'medium' | 'low' | 'unknown';

/** Une ligne de l'artefact brut produit par un runner. */
export type RunRecord = {
  case_id: string;
  arm: 'A' | 'B' | 'C' | 'D';
  http_status: number | null;
  latency_ms: number;
  /** Réponse telle que renvoyée, non normalisée. `null` si l'appel a échoué. */
  answer: Record<string, unknown> | null;
  confidence: { band: ConfidenceBand; score: number | null };
  error: string | null;
};

export type RunArtifact = {
  run_id: string;
  arm: 'A' | 'B' | 'C' | 'D';
  contract_version: string | null;
  dataset_version: string;
  index_version: string | null;
  started_at: string;
  finished_at: string;
  endpoint: string;
  n: number;
};

export type BenchIndexDocument = {
  id: string;
  title: string;
  brand_slug: string | null;
  page_count: number | null;
  pages_extracted: number;
  pages_with_snapshot: number;
};

export type BenchIndex = {
  exported_at: string;
  documents: BenchIndexDocument[];
  brand_aliases: Record<string, string[]>;
};

export type RubricResult = {
  verdict: Verdict;
  reason: string;
};

export type CaseScore = {
  case_id: string;
  strata: BenchCase['strata'];
  no_answer_kind: BenchCase['no_answer_kind'];
  gate_critical: boolean;
  contamination_risk: boolean;
  corpus_leakage: boolean;
  observed_state: string | null;
  confidence_band: ConfidenceBand;
  format_compliant: boolean;
  format_reason: string;
  rubrics: Partial<Record<RubricName, RubricResult>>;
  /** Signaux secondaires, jamais bloquants. */
  signals: {
    meaning_overlap: number | null;
    citation_matches_ground_truth: boolean | null;
    state_matches_expected: boolean | null;
  };
};
