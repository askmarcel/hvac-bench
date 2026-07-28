import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { callChatModel } from '../llm-client.js';

export type JudgeGrade = {
  cause_ok: boolean;
  solution_ok: boolean;
  piege: boolean;
  valeur_attendue_annoncee: boolean;
};

export type Verite = {
  cause: string;
  solution: string;
  verification: string;
  pieges: string[];
};

const PROMPT_PATH = resolve(import.meta.dirname, '../prompts/juge.md');
const PROMPT_TEMPLATE = readFileSync(PROMPT_PATH, 'utf8');

const JUDGE_MODEL_ENV = ['AM_JUDGE_MODEL'];
const JUDGE_API_KEY_ENV = ['AM_JUDGE_API_KEY', 'OPENROUTER_API_KEY', 'OPENAI_API_KEY'];

function resolveJudgeModel(): string {
  for (const name of JUDGE_MODEL_ENV) {
    const v = process.env[name];
    if (v) return v;
  }
  throw new Error(
    'AM_JUDGE_MODEL non défini. Le juge doit utiliser un modèle explicite, distinct du bras testé (voir PLAN §3.4).',
  );
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error(`Réponse du juge non-JSON: "${text.slice(0, 300)}"`);
  }
}

function isBool(v: unknown): v is boolean {
  return typeof v === 'boolean';
}

function assertGradeShape(raw: unknown): JudgeGrade {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Grade du juge : objet attendu');
  }
  const r = raw as Record<string, unknown>;
  const keys: (keyof JudgeGrade)[] = ['cause_ok', 'solution_ok', 'piege', 'valeur_attendue_annoncee'];
  for (const k of keys) {
    if (!isBool(r[k])) throw new Error(`Grade du juge : champ '${k}' manquant ou non booléen`);
  }
  return {
    cause_ok: r.cause_ok as boolean,
    solution_ok: r.solution_ok as boolean,
    piege: r.piege as boolean,
    valeur_attendue_annoncee: r.valeur_attendue_annoncee as boolean,
  };
}

export async function judgeTranscript(args: {
  verite: Verite;
  transcript: string;
}): Promise<JudgeGrade> {
  const system = PROMPT_TEMPLATE.replace('{{verite}}', JSON.stringify(args.verite)).replace(
    '{{transcript}}',
    args.transcript,
  );

  const text = await callChatModel({
    model: resolveJudgeModel(),
    messages: [{ role: 'system', content: system }, { role: 'user', content: 'Note ce transcript.' }],
    temperature: 0,
    apiKeyEnvVars: JUDGE_API_KEY_ENV,
    maxOutputTokens: 150,
  });

  return assertGradeShape(extractJsonObject(text));
}
