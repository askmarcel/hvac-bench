export type V2Case = {
  id: string;
  hypotheses: Array<{ id: string; true_cause: boolean; label?: string; prior?: number }>;
  tests: Array<{
    action_id: string;
    observation?: string;
    resolves?: boolean;
    wrong_part?: boolean;
    cost_eur?: number;
    minutes?: number;
  }>;
  expert_path: string[];
  forbidden_before?: Record<string, string[]>;
  escalation_expected?: { kind: string } | null;
  meta: { family: string };
  flags: { sparse_priors: boolean };
};

export type V2RunRecord = {
  case_id: string;
  replicate: number;
  arm: string;
  path: string[];
  concluded: boolean;
  cause_id: string | null;
  true_cause_id: string;
  turns: number;
  final_output: Record<string, unknown>;
  format_fail?: boolean;
  hypotheses_final?: Array<{ id: string; prior: number; label?: string }>;
  hypotheses_initial?: Array<{ id: string; prior: number; label?: string }>;
};

export type WilsonCI = { low: number; high: number };

export type V2Metrics = {
  scorer_version: string;
  n: number;
  convergence_at_3: number;
  convergence_at_5: number;
  path_cost_ratio_median: number | null;
  path_cost_ratio_n: number;
  wrong_part_rate: number | null;
  premature_closure_rate: number | null;
  ordering_violation_rate: number;
  register_violation_rate: number;
  escalation_precision: number;
  escalation_recall: number;
  guided_coverage_rate: number;
  format_compliance_rate: number;
  top3_accuracy: number | null;
  convergence_at_3_ci: WilsonCI | null;
  convergence_at_5_ci: WilsonCI | null;
  expert_path_first_hit_rate: number;
  invasive_wrong_first_rate: number;
  median_delta_log_odds: number | null;
  mean_true_cause_rank_final: number | null;
};
