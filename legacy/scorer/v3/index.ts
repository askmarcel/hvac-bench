/**
 * Scorer v3 — métriques oracle O_tree_db (P2 falsification).
 */
import { GATE_ESCALADE_CASE_IDS } from '../../lib/v3/gate-roster.js';
import type { V3Case } from '../../lib/v3/types.js';
import type { V3RunRecord } from '../../runners/o-tree-case.js';
import { wilsonCI } from '../v2/stats.js';

export const SCORER_V3_VERSION = '0.1.0';

export type V3Metrics = {
  scorer_version: string;
  n: number;
  convergence_at_5: number;
  convergence_at_5_numerator: number;
  convergence_at_5_denominator: number;
  convergence_at_5_ci: ReturnType<typeof wilsonCI>;
  premature_closure_rate: number | null;
  escalation_recall: number;
  escalation_recall_numerator: number;
  escalation_recall_denominator: number;
  false_conclusions_on_escalade: number;
  escalation_precision: number;
};

function isEscaladeCase(caseId: string): boolean {
  return (GATE_ESCALADE_CASE_IDS as readonly string[]).includes(caseId);
}

function isDiagnosticSuccess(v3Case: V3Case, record: V3RunRecord): boolean {
  return (
    record.concluded &&
    record.cause_id === v3Case.ground_truth.cause_id &&
    record.turns <= 5
  );
}

function isEscalationSuccess(record: V3RunRecord): boolean {
  const lastAction = record.path[record.path.length - 1] ?? '';
  return record.final_output.state === 'escalation' && lastAction.startsWith('ESC-');
}

export function scoreV3Run(cases: V3Case[], records: V3RunRecord[]): V3Metrics {
  const caseMap = new Map(cases.map((c) => [c.id, c]));
  const n = records.length;

  let conv5Num = 0;
  let conv5Den = 0;
  let prematureNum = 0;
  let prematureDen = 0;
  let escRecallNum = 0;
  let escRecallDen = 0;
  let falseConclusionsEsc = 0;
  let escFp = 0;

  for (const r of records) {
    const c = caseMap.get(r.case_id);
    if (!c) continue;

    if (isEscaladeCase(c.id)) {
      escRecallDen++;
      if (isEscalationSuccess(r)) escRecallNum++;
      if (r.concluded) falseConclusionsEsc++;
    } else {
      conv5Den++;
      if (isDiagnosticSuccess(c, r)) conv5Num++;

      if (r.concluded) {
        prematureDen++;
        if (r.cause_id !== c.ground_truth.cause_id) prematureNum++;
      }
    }

    if (!isEscaladeCase(c.id) && r.final_output.state === 'escalation') {
      escFp++;
    }
  }

  const escPrecisionDenom = escRecallNum + escFp;

  return {
    scorer_version: SCORER_V3_VERSION,
    n,
    convergence_at_5: conv5Den ? conv5Num / conv5Den : 0,
    convergence_at_5_numerator: conv5Num,
    convergence_at_5_denominator: conv5Den,
    convergence_at_5_ci: wilsonCI(conv5Num, conv5Den),
    premature_closure_rate: prematureDen ? prematureNum / prematureDen : null,
    escalation_recall: escRecallDen ? escRecallNum / escRecallDen : 0,
    escalation_recall_numerator: escRecallNum,
    escalation_recall_denominator: escRecallDen,
    false_conclusions_on_escalade: falseConclusionsEsc,
    escalation_precision: escPrecisionDenom ? escRecallNum / escPrecisionDenom : 0,
  };
}

export function scoreDiagnosticSubset(
  cases: V3Case[],
  records: V3RunRecord[],
): Pick<
  V3Metrics,
  | 'convergence_at_5'
  | 'convergence_at_5_numerator'
  | 'convergence_at_5_denominator'
  | 'convergence_at_5_ci'
  | 'premature_closure_rate'
> {
  const diagnosticCases = cases.filter((c) => !isEscaladeCase(c.id));
  const diagnosticIds = new Set(diagnosticCases.map((c) => c.id));
  const subset = records.filter((r) => diagnosticIds.has(r.case_id));
  const m = scoreV3Run(diagnosticCases, subset);
  return {
    convergence_at_5: m.convergence_at_5,
    convergence_at_5_numerator: m.convergence_at_5_numerator,
    convergence_at_5_denominator: m.convergence_at_5_denominator,
    convergence_at_5_ci: m.convergence_at_5_ci,
    premature_closure_rate: m.premature_closure_rate,
  };
}

export function scoreEscaladeSubset(
  cases: V3Case[],
  records: V3RunRecord[],
): Pick<
  V3Metrics,
  | 'escalation_recall'
  | 'escalation_recall_numerator'
  | 'escalation_recall_denominator'
  | 'false_conclusions_on_escalade'
> {
  const escCases = cases.filter((c) => isEscaladeCase(c.id));
  const escIds = new Set(escCases.map((c) => c.id));
  const subset = records.filter((r) => escIds.has(r.case_id));
  const m = scoreV3Run(escCases, subset);
  return {
    escalation_recall: m.escalation_recall,
    escalation_recall_numerator: m.escalation_recall_numerator,
    escalation_recall_denominator: m.escalation_recall_denominator,
    false_conclusions_on_escalade: m.false_conclusions_on_escalade,
  };
}
