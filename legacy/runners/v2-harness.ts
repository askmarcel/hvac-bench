/**
 * Harness v2 partagé — chargement cas, observations, registre.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { V2Case, V2RunRecord } from '../scorer/v2/index.js';

export const T_MAX = 5;
export const NEUTRAL_OBSERVATION =
  'Test effectué — rien d\'anormal constaté sur ce point de contrôle.';

export function loadV2Cases(casesPath?: string): V2Case[] {
  const path =
    casesPath ??
    resolve(import.meta.dirname, '../dataset/pilot/pilot-v2.jsonl');
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as V2Case);
}

export function loadActionRegistry(): Array<{ action_id: string; label: string; prefix?: string }> {
  const path = resolve(import.meta.dirname, '../taxonomy/actions-v2.json');
  const file = JSON.parse(readFileSync(path, 'utf8')) as {
    actions: Array<{ action_id: string; label: string; prefix?: string }>;
  };
  return file.actions;
}

export function diagnosticActionIds(): string[] {
  return loadActionRegistry()
    .filter((a) => !a.action_id.startsWith('ESC-'))
    .map((a) => a.action_id);
}

export function trueCauseId(c: V2Case): string {
  return c.hypotheses.find((h) => h.true_cause)!.id;
}

export function lookupObservation(
  c: V2Case,
  actionId: string,
): { observation: string; resolves: boolean } {
  const test = c.tests.find((t) => t.action_id === actionId);
  if (test) {
    return {
      observation: test.observation ?? NEUTRAL_OBSERVATION,
      resolves: test.resolves ?? false,
    };
  }
  return { observation: NEUTRAL_OBSERVATION, resolves: false };
}

export function buildRunRecord(args: {
  c: V2Case;
  arm: string;
  replicate: number;
  path: string[];
  concluded: boolean;
  cause_id: string | null;
  turns: number;
  final_output: Record<string, unknown>;
  format_fail?: boolean;
  hypotheses_final?: Array<{ id: string; prior: number }>;
  hypotheses_initial?: Array<{ id: string; prior: number }>;
}): V2RunRecord {
  return {
    case_id: args.c.id,
    replicate: args.replicate,
    arm: args.arm,
    path: args.path,
    concluded: args.concluded,
    cause_id: args.cause_id,
    true_cause_id: trueCauseId(args.c),
    turns: args.turns,
    final_output: args.final_output,
    format_fail: args.format_fail,
    hypotheses_final: args.hypotheses_final,
    hypotheses_initial: args.hypotheses_initial,
  };
}

export type PilotCaseExtended = V2Case & {
  symptom: { narrative: string; code_present: string | null; code_absent_by_design?: boolean };
  context: {
    brand: string | null;
    model?: string | null;
    equipment_type: string;
    in_corpus: boolean;
    season?: string | null;
    emitter?: string | null;
  };
  initial_readings?: Record<string, unknown>;
  locale?: string;
  manual_context?: { document_id: string; page: number; excerpt: string; title: string } | null;
};

/** Boucle interactive partagée (calibration + smoke). */
export function runInteractiveLoop(args: {
  c: V2Case;
  arm: string;
  replicate: number;
  pickAction: (ctx: {
    c: V2Case;
    path: string[];
    turns: number;
    lastObservation: string | null;
  }) => string | null;
  onTurnEnd?: (ctx: { actionId: string; observation: string }) => void;
}): V2RunRecord {
  const path: string[] = [];
  let turns = 0;
  let concluded = false;
  let cause_id: string | null = null;
  let final_output: Record<string, unknown> = {};
  let lastObservation: string | null = null;

  while (turns < T_MAX) {
    const nextAction = args.pickAction({ c: args.c, path, turns, lastObservation });
    if (!nextAction) break;

    const { observation, resolves } = lookupObservation(args.c, nextAction);
    path.push(nextAction);
    turns++;
    lastObservation = observation;
    args.onTurnEnd?.({ actionId: nextAction, observation });

    if (resolves) {
      concluded = true;
      cause_id = trueCauseId(args.c);
      final_output = {
        state: 'conclusion',
        cause_id,
        steps: [{ order: 1, text: observation }],
      };
      break;
    }
  }

  if (!concluded) {
    if (args.c.meta.family === 'escalade_legitime' && args.c.escalation_expected) {
      final_output = {
        state: 'escalation',
        escalation: args.c.escalation_expected,
      };
      concluded = true;
      cause_id = null;
    } else {
      final_output = { state: 'non_convergent', path };
    }
  }

  return buildRunRecord({
    c: args.c,
    arm: args.arm,
    replicate: args.replicate,
    path,
    concluded,
    cause_id,
    turns,
    final_output,
  });
}
