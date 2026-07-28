/**
 * Simulateur local bras D / R — miroir session-store (VOI + bayesUpdate) sans API.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { hypothesisActionsMap } from './hypothesis-matrix.js';

import {
  bayesUpdate,
  buildTestFromCaseAnnotation,
  inferBayesFromObservation,
  pickNextAction,
  shouldConclude,
  type CaseTest,
  type HypothesisState,
  type ObservationOutcome,
} from './bayes-engine.js';
import {
  buildRunRecord,
  diagnosticActionIds,
  lookupObservation,
  T_MAX,
  type PilotCaseExtended,
} from '../runners/v2-harness.js';

const LAMBDA_INVASIVENESS = 25;

function loadActionCosts(): Map<string, number> {
  const path = resolve(import.meta.dirname, '../taxonomy/actions-v2.json');
  const file = JSON.parse(readFileSync(path, 'utf8')) as {
    actions: Array<{ action_id: string; cost_eur_default: number; invasiveness: number }>;
  };
  return new Map(
    file.actions.map((a) => [
      a.action_id,
      a.cost_eur_default + LAMBDA_INVASIVENESS * a.invasiveness,
    ]),
  );
}

function hypothesisActionsForCase(hypothesisIds: string[]): Map<string, string[]> {
  return hypothesisActionsMap(hypothesisIds);
}

function caseTestsMap(c: PilotCaseExtended): Map<string, CaseTest> {
  const map = new Map<string, CaseTest>();
  for (const t of c.tests ?? []) {
    map.set(
      t.action_id,
      buildTestFromCaseAnnotation(
        t.action_id,
        t.observation,
        t.discriminates ?? [],
        t.eliminates ?? [],
        t.resolves,
      ),
    );
    const row = map.get(t.action_id)!;
    if (t.polarity) row.polarity = t.polarity as CaseTest['polarity'];
  }
  return map;
}

function applyTurn(
  mem: {
    hypotheses: HypothesisState[];
    discriminantExecuted: boolean;
    hypothesisActions: Map<string, string[]>;
    caseTests: Map<string, CaseTest>;
  },
  actionId: string,
  observation: string,
): void {
  const test = mem.caseTests.get(actionId);
  if (test) {
    if (test.discriminates.length > 0) mem.discriminantExecuted = true;
    mem.hypotheses = bayesUpdate(mem.hypotheses, test);
  } else {
    mem.hypotheses = inferBayesFromObservation(
      mem.hypotheses,
      actionId,
      observation,
      mem.hypothesisActions,
    );
    const linked = [...mem.hypothesisActions.entries()]
      .filter(([, actions]) => actions.includes(actionId))
      .map(([hid]) => hid);
    if (linked.length > 0) {
      const derived: ObservationOutcome = observation.match(
        /conforme|normal|dans la plage|stable|ok\b|rien d.anormal/i,
      )
        ? 'normal'
        : 'abnormal';
      if (derived !== 'normal') mem.discriminantExecuted = true;
    }
  }
  if (test?.resolves) mem.discriminantExecuted = true;
}

export type ProdLocalRunOptions = {
  conclusionThreshold?: number;
  pickAction: (ctx: {
    c: PilotCaseExtended;
    path: string[];
    turns: number;
    replicate: number;
    available: string[];
    executed: Set<string>;
    pickVoi: () => string | null;
  }) => string | null;
};

export function runCaseProdLocal(
  c: PilotCaseExtended,
  replicate: number,
  arm: 'D' | 'R',
  options: ProdLocalRunOptions,
) {
  const actionCosts = loadActionCosts();
  const candidateIds = diagnosticActionIds();
  const hypothesisIds = c.hypotheses.map((h) => h.id);
  const mem = {
    hypotheses: c.hypotheses.map((h) => ({
      id: h.id,
      label: h.label ?? h.id,
      prior: h.prior ?? 1 / c.hypotheses.length,
      n_observations: (h as { n_observations?: number }).n_observations,
    })),
    executed: new Set<string>(),
    discriminantExecuted: false,
    hypothesisActions: hypothesisActionsForCase(hypothesisIds),
    caseTests: caseTestsMap(c),
  };

  const path: string[] = [];
  let turns = 0;
  let concluded = false;
  let cause_id: string | null = null;
  let final_output: Record<string, unknown> = { state: 'non_convergent' };
  const turn_trace: Array<{
    turn: number;
    action_id: string;
    discriminantExecuted: boolean;
    hypotheses: HypothesisState[];
  }> = [];

  const pickVoi = () =>
    pickNextAction(
      mem.hypotheses,
      candidateIds,
      actionCosts,
      mem.executed,
      mem.hypothesisActions,
      `${c.id}:${replicate}`,
    );

  while (turns < T_MAX) {
    const available = candidateIds.filter((id) => !mem.executed.has(id));
    const nextAction = options.pickAction({
      c,
      path,
      turns,
      replicate,
      available,
      executed: mem.executed,
      pickVoi,
    });
    if (!nextAction) break;

    const { observation } = lookupObservation(c, nextAction);
    path.push(nextAction);
    mem.executed.add(nextAction);
    turns++;
    applyTurn(mem, nextAction, observation);
    turn_trace.push({
      turn: turns,
      action_id: nextAction,
      discriminantExecuted: mem.discriminantExecuted,
      hypotheses: mem.hypotheses.map((h) => ({ ...h })),
    });

    const { conclude, causeId } = shouldConclude(
      mem.hypotheses,
      mem.discriminantExecuted,
      options.conclusionThreshold,
    );
    if (conclude && causeId) {
      concluded = true;
      cause_id = causeId;
      final_output = {
        state: 'conclusion',
        cause_id: causeId,
        hypotheses_ranked: mem.hypotheses,
        turn: turns,
      };
      break;
    }
  }

  if (!concluded) {
    if (turns >= T_MAX) {
      final_output = { state: 'escalation', turn: turns };
    } else {
      final_output = { state: 'non_convergent', hypotheses_ranked: mem.hypotheses, turn: turns, turn_trace };
    }
  }

  if (!('turn_trace' in final_output)) {
    (final_output as Record<string, unknown>).turn_trace = turn_trace;
  }

  return buildRunRecord({
    c,
    arm,
    replicate,
    path,
    concluded,
    cause_id,
    turns,
    final_output,
    hypotheses_final: mem.hypotheses,
    hypotheses_initial: c.hypotheses.map((h) => ({
      id: h.id,
      prior: h.prior ?? 0,
    })),
  });
}

function seededRandom(caseId: string, replicate: number, turn: number): number {
  const h = createHash('sha256').update(`${caseId}:${replicate}:${turn}`).digest();
  return h[0]! / 255;
}

export function runCaseDLocal(
  c: PilotCaseExtended,
  replicate: number,
  conclusionThreshold?: number,
) {
  return runCaseProdLocal(c, replicate, 'D', {
    conclusionThreshold,
    pickAction: ({ pickVoi }) => pickVoi(),
  });
}

export function runCaseRLocal(
  c: PilotCaseExtended,
  replicate: number,
  conclusionThreshold?: number,
) {
  return runCaseProdLocal(c, replicate, 'R', {
    conclusionThreshold,
    pickAction: ({ c: caseRow, turns, replicate: rep, available }) => {
      if (!available.length) return null;
      const idx = Math.floor(seededRandom(caseRow.id, rep, turns) * available.length);
      return available[idx] ?? null;
    },
  });
}
