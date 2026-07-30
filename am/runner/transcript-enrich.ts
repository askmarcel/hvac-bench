import type { HarnessStepSnapshot, HarnessTurnResponse } from './harness-client.js';
import {
  extractPlagesFromTechnicienText,
  inferActionIdFromTechnicienText,
  quantityHintFromSteps,
} from './transcript-parse.js';
import type { PlageAnnoncee, RunVerdict } from '../scorer/mechanical.js';

export type TranscriptTurnBase = {
  role: 'technicien' | 'installateur';
  content: string;
};

export type EnrichedTurnFields = {
  action_id?: string;
  plages_annoncees?: PlageAnnoncee[];
  finish_reason?: string;
  warnings?: string[];
};

export type EnrichTurnResult = EnrichedTurnFields & {
  verdict?: RunVerdict | null;
};

type AcceptedDiagnosticSnapshot = NonNullable<HarnessTurnResponse['acceptedDiagnostic']>;

function isAcceptedDiagnostic(output: unknown): output is AcceptedDiagnosticSnapshot {
  return (
    typeof output === 'object' &&
    output !== null &&
    'accepted' in output &&
    (output as { accepted: boolean }).accepted === true &&
    'verdict' in output
  );
}

function extractVerdictFromDiagnostic(diagnostic: AcceptedDiagnosticSnapshot): RunVerdict {
  if (diagnostic.verdict === 'escalade') {
    return {
      type: 'escalade',
      escalade_motif: diagnostic.escalade?.motif,
    };
  }
  return {
    type: 'conclusion',
    cause_id: diagnostic.cause,
  };
}

function resolveAcceptedDiagnostic(
  response: HarnessTurnResponse,
  steps: HarnessStepSnapshot[],
): AcceptedDiagnosticSnapshot | undefined {
  if (response.acceptedDiagnostic) return response.acceptedDiagnostic;
  let last: AcceptedDiagnosticSnapshot | undefined;
  for (const step of steps) {
    for (const result of step.toolResults ?? []) {
      if (result.toolName === 'presentDiagnostic' && isAcceptedDiagnostic(result.output)) {
        last = result.output;
      }
    }
  }
  return last;
}

export function enrichTurnFromHarnessResponse(
  response: HarnessTurnResponse,
  options?: { plageCondition?: string },
): EnrichTurnResult {
  const steps = response.steps ?? [];
  const technicienText = response.text;
  const quantityHint = quantityHintFromSteps(steps);

  const { plages, hintMismatch } = extractPlagesFromTechnicienText(technicienText, {
    quantityHint,
    condition: options?.plageCondition,
  });
  const action_id = inferActionIdFromTechnicienText(technicienText);

  const accepted = resolveAcceptedDiagnostic(response, steps);
  const verdict = accepted ? extractVerdictFromDiagnostic(accepted) : null;

  const warnings = [...response.warnings];
  if (hintMismatch) warnings.push(hintMismatch);

  return {
    action_id,
    plages_annoncees: plages.length > 0 ? plages : undefined,
    finish_reason: response.finishReason,
    warnings: warnings.length > 0 ? warnings : undefined,
    verdict,
  };
}

export function isTerminalVerdict(verdict: RunVerdict | null | undefined): boolean {
  return verdict?.type === 'conclusion' || verdict?.type === 'escalade';
}
