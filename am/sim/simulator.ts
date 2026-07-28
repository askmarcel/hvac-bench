import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { callChatModel, type ChatMessage } from '../llm-client.js';

export type AmCase = {
  id: string;
  equipement: Record<string, unknown>;
  installation: Record<string, unknown>;
  plainte_initiale: string;
  etat_operatoire: string;
  ground_state: Record<string, unknown>;
  evolution: Array<{ si_action: string; alors: Record<string, unknown> }>;
};

export type SimTurn = { role: 'technicien' | 'installateur'; content: string };

export type SimReplyResult = {
  reply: string;
  /** true si la question portait sur une grandeur absente de ground_state (réponse attendue: "je ne peux pas mesurer ça"). */
  gap: boolean;
};

const PROMPT_PATH = resolve(import.meta.dirname, '../prompts/simulateur-installateur.md');
const PROMPT_TEMPLATE = readFileSync(PROMPT_PATH, 'utf8');

const SIM_MODEL_ENV = ['AM_SIM_MODEL'];
const SIM_API_KEY_ENV = ['AM_SIM_API_KEY', 'OPENROUTER_API_KEY', 'OPENAI_API_KEY'];

function resolveSimModel(): string {
  for (const name of SIM_MODEL_ENV) {
    const v = process.env[name];
    if (v) return v;
  }
  throw new Error(
    `AM_SIM_MODEL non défini. Le simulateur doit utiliser un modèle explicite (pas de défaut implicite — leçon O10).`,
  );
}

function buildSystemPrompt(c: AmCase): string {
  return PROMPT_TEMPLATE.replace('{{equipement}}', JSON.stringify(c.equipement))
    .replace('{{installation}}', JSON.stringify(c.installation))
    .replace('{{plainte_initiale}}', c.plainte_initiale)
    .replace('{{etat_operatoire}}', c.etat_operatoire)
    .replace('{{ground_state}}', JSON.stringify(c.ground_state))
    .replace('{{evolution}}', JSON.stringify(c.evolution));
}

/**
 * Heuristique de détection "gap" — ne sert qu'au reporting/log, PAS à décider de la
 * réponse (c'est le prompt + le LLM qui décident). Sert à check-sim pour vérifier que
 * le simulateur a bien répondu "je ne peux pas mesurer ça" quand c'est attendu.
 */
export function replyLooksLikeGapRefusal(reply: string): boolean {
  return /je ne peux pas (le )?(mesurer|ouvrir|faire)|pas (l'appareil|habilit|equipe pour|équipé pour)|j'ai pas (ça|l')/i.test(
    reply,
  );
}

export async function simulateInstallerReply(args: {
  amCase: AmCase;
  history: SimTurn[];
  technicianMessage: string;
  /** Pour les fixtures de contrôle : la question porte-t-elle sur une grandeur hors ground_state ? */
  expectedGap?: boolean;
}): Promise<SimReplyResult> {
  const system = buildSystemPrompt(args.amCase);
  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    ...args.history.map((t) => ({
      role: (t.role === 'technicien' ? 'user' : 'assistant') as ChatMessage['role'],
      content: t.content,
    })),
    { role: 'user', content: args.technicianMessage },
  ];

  const reply = await callChatModel({
    model: resolveSimModel(),
    messages,
    temperature: 0,
    apiKeyEnvVars: SIM_API_KEY_ENV,
    maxOutputTokens: 200,
  });

  return {
    reply: reply.trim(),
    gap: replyLooksLikeGapRefusal(reply),
  };
}
