/**
 * Oracle O_tree_db — rejoue expert_path via moteur v3 + arbre P0.
 * Suit expert_path (pas l'ordre observations[]) ; ESC-* → escalation forcée.
 */
import { shouldConclude } from '../lib/bayes-engine.js';
import { initSessionV3, runObservationStep } from '../lib/v3/engine-v3.js';
import { getConclusionThresholdV3 } from '../lib/v3/conclusion-threshold-v3.js';
import { enrichCaseContext } from '../lib/v3/operating-state.js';
import type { V3Case } from '../lib/v3/types.js';
import { T_MAX } from './v2-harness.js';

export type V3RunRecord = {
  case_id: string;
  replicate: number;
  arm: string;
  path: string[];
  concluded: boolean;
  cause_id: string | null;
  true_cause_id: string;
  turns: number;
  final_output: Record<string, unknown>;
  hypotheses_final?: Array<{ id: string; prior: number; label?: string }>;
};

export function buildV3RunRecord(args: {
  v3Case: V3Case;
  arm: string;
  replicate: number;
  path: string[];
  concluded: boolean;
  cause_id: string | null;
  turns: number;
  final_output: Record<string, unknown>;
  hypotheses_final?: Array<{ id: string; prior: number; label?: string }>;
}): V3RunRecord {
  return {
    case_id: args.v3Case.id,
    replicate: args.replicate,
    arm: args.arm,
    path: args.path,
    concluded: args.concluded,
    cause_id: args.cause_id,
    true_cause_id: args.v3Case.ground_truth.cause_id,
    turns: args.turns,
    final_output: args.final_output,
    hypotheses_final: args.hypotheses_final,
  };
}

function isDiscriminantAction(actionId: string): boolean {
  return actionId.startsWith('MES-') || actionId.startsWith('OBS-');
}

export function runCaseOtreeDb(
  v3Case: V3Case,
  replicate = 0,
  options?: { conclusionThreshold?: number },
): V3RunRecord {
  const context = enrichCaseContext(v3Case.context, v3Case.symptom);
  const threshold = options?.conclusionThreshold ?? getConclusionThresholdV3();
  let state = initSessionV3({ ...v3Case, context });
  const path: string[] = [];
  let turns = 0;
  let concluded = false;
  let cause_id: string | null = null;
  let final_output: Record<string, unknown> = { state: 'non_convergent' };

  const obsByAction = new Map(v3Case.observations.map((o) => [o.action_id, o]));

  for (const actionId of v3Case.expert_path) {
    if (turns >= T_MAX) break;

    if (actionId.startsWith('ESC-')) {
      path.push(actionId);
      turns++;
      final_output = { state: 'escalation', turn: turns, escalation_action: actionId };
      return buildV3RunRecord({
        v3Case,
        arm: 'O_tree_db',
        replicate,
        path,
        concluded: false,
        cause_id: null,
        turns,
        final_output,
        hypotheses_final: state.hypotheses,
      });
    }

    const obs = obsByAction.get(actionId);
    if (!obs) {
      throw new Error(`${v3Case.id}: observation manquante pour action ${actionId} sur expert_path`);
    }

    path.push(actionId);
    turns++;
    state = runObservationStep(state, obs);

    const discriminantDone = path.some(isDiscriminantAction);
    const { conclude, causeId } = shouldConclude(state.hypotheses, discriminantDone, threshold);
    if (conclude && causeId) {
      concluded = true;
      cause_id = causeId;
      final_output = {
        state: 'conclusion',
        cause_id: causeId,
        hypotheses_ranked: state.hypotheses,
        turn: turns,
      };
      break;
    }
  }

  if (!concluded && turns >= T_MAX) {
    final_output = { state: 'escalation', turn: turns };
  } else if (!concluded) {
    final_output = {
      state: 'non_convergent',
      hypotheses_ranked: state.hypotheses,
      turn: turns,
    };
  }

  return buildV3RunRecord({
    v3Case,
    arm: 'O_tree_db',
    replicate,
    path,
    concluded,
    cause_id,
    turns,
    final_output,
    hypotheses_final: state.hypotheses,
  });
}
