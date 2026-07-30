/**
 * Contrat transcript runner → scorer (O11).
 * Toute modification de TranscriptRecord doit rester assignable à RunTranscript.
 */
import type { RunTranscript, RunTurn, RunVerdict } from '../scorer/mechanical.js';

export type TranscriptTurn = RunTurn & {
  finish_reason?: string;
  warnings?: string[];
};

export type TranscriptRecord = {
  case_id: string;
  replicate: number;
  turns: TranscriptTurn[];
  verdict: RunVerdict | null;
  status: 'completed' | 'blocked' | 'error';
  blocked_reason?: string;
};

/** Assertion compile-time : le producteur respecte le contrat scorer. */
type _AssertRunnerProducesRunTranscript = TranscriptRecord extends {
  case_id: string;
  turns: RunTurn[];
  verdict: RunVerdict | null;
}
  ? true
  : never;

export const _transcriptContractCheck: _AssertRunnerProducesRunTranscript = true;

export function toRunTranscript(record: TranscriptRecord): RunTranscript {
  return {
    case_id: record.case_id,
    turns: record.turns,
    verdict: record.verdict,
  };
}
