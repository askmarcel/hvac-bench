#!/usr/bin/env tsx
/**
 * am:check-sim — rejoue les dialogues de contrôle du simulateur d'installateur (T4).
 * Échoue PROPREMENT (message distinct) si aucune clé API LLM n'est configurée —
 * ne jamais transformer une impossibilité de test en faux succès.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { MissingApiKeyError } from '../llm-client.js';
import { replyLooksLikeGapRefusal, simulateInstallerReply, type AmCase } from '../sim/simulator.js';

const AM_ROOT = resolve(import.meta.dirname, '..');
const FIXTURES_PATH = resolve(AM_ROOT, 'sim/fixtures/control-dialogues.json');

type Dialogue = {
  name: string;
  case_id: string;
  history: Array<{ role: 'technicien' | 'installateur'; content: string }>;
  technicien_message: string;
  check: 'no_leak' | 'gap_expected' | 'value_given';
  expected_value_ground_state_key?: string;
  note?: string;
};

type FullCase = AmCase & { verite: { cause: string } };

function loadCase(caseId: string): FullCase {
  const path = resolve(AM_ROOT, 'cases/dev', `${caseId}.json`);
  return JSON.parse(readFileSync(path, 'utf8')) as FullCase;
}

const STOPWORDS = new Set([
  'dans',
  'avec',
  'pour',
  'suite',
  'apres',
  'après',
  'circuit',
  'depuis',
  'sans',
  'plus',
  'tres',
  'très',
]);

function causeKeywords(cause: string): string[] {
  return cause
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 5 && !STOPWORDS.has(w));
}

function normalizeForMatch(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function checkNoLeak(reply: string, cause: string): { ok: boolean; detail: string } {
  const replyNorm = normalizeForMatch(reply);
  const hits = causeKeywords(cause).filter((kw) => replyNorm.includes(kw));
  return {
    ok: hits.length === 0,
    detail: hits.length > 0 ? `mots-clés de la cause repérés dans la réponse: ${hits.join(', ')}` : 'aucun leak détecté',
  };
}

function checkValueGiven(reply: string, expected: unknown): { ok: boolean; detail: string } {
  if (expected == null) return { ok: false, detail: 'clé ground_state attendue introuvable' };
  const asString = String(expected);
  const withComma = asString.replace('.', ',');
  const ok = reply.includes(asString) || reply.includes(withComma);
  return { ok, detail: ok ? `valeur ${asString} retrouvée` : `valeur ${asString} absente de la réponse: "${reply}"` };
}

async function main() {
  const { dialogues } = JSON.parse(readFileSync(FIXTURES_PATH, 'utf8')) as { dialogues: Dialogue[] };

  let pass = 0;
  const results: string[] = [];

  for (const d of dialogues) {
    const amCase = loadCase(d.case_id);
    try {
      const { reply, gap } = await simulateInstallerReply({
        amCase,
        history: d.history,
        technicianMessage: d.technicien_message,
      });

      let ok: boolean;
      let detail: string;
      if (d.check === 'no_leak') {
        ({ ok, detail } = checkNoLeak(reply, amCase.verite.cause));
      } else if (d.check === 'gap_expected') {
        ok = gap || replyLooksLikeGapRefusal(reply);
        detail = ok ? 'refus/gap bien exprimé' : `réponse ne ressemble pas à un refus/gap: "${reply}"`;
      } else {
        const key = d.expected_value_ground_state_key!;
        ({ ok, detail } = checkValueGiven(reply, amCase.ground_state[key]));
      }

      if (ok) pass++;
      results.push(`${ok ? '✅' : '❌'} ${d.name} — ${detail}\n   réponse: "${reply}"`);
    } catch (e) {
      if (e instanceof MissingApiKeyError) throw e; // remonte tel quel, géré en bas
      results.push(`❌ ${d.name} — erreur d'appel: ${(e as Error).message}`);
    }
  }

  console.log(results.join('\n\n'));
  console.log(`\n${pass}/${dialogues.length} dialogues conformes.`);
  if (pass < dialogues.length) process.exit(1);
}

main().catch((e) => {
  if (e instanceof MissingApiKeyError) {
    console.error(`\n🚫 am:check-sim BLOQUÉ (pas un échec de test, une impossibilité de test) : ${e.message}`);
    console.error('Définir AM_SIM_API_KEY (ou OPENROUTER_API_KEY / OPENAI_API_KEY) et AM_SIM_MODEL pour exécuter ce check.');
    process.exit(2);
  }
  console.error(e);
  process.exit(1);
});
