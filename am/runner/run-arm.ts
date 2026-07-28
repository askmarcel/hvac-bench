#!/usr/bin/env tsx
/**
 * am:run — T7. Boucle harnais (bras testé) ↔ simulateur d'installateur (T4) sur les
 * cas d'un split, N réplicats, jusqu'à 12 tours. Écrit un transcript rejouable par cas
 * + un manifest tracé au SHA WebApp près (leçon O6/O10).
 *
 * Usage: tsx am/runner/run-arm.ts --arm PROD --split dev --replicates 3 [--cases ham-0001,ham-0002]
 *
 * Prérequis pour une boucle réelle (T10+) :
 *  - WebApp dev ou preview (`AM_HARNESS_URL`, défaut localhost:3000)
 *  - `AM_HARNESS_BEARER_TOKEN` (JWT Supabase utilisateur bench)
 *  - Clés simulateur (`AM_SIM_*`) — absentes en local volontairement, fournies en CI
 * Sans token ou serveur : échec propre par cas (`status: blocked`), jamais un faux succès.
 *
 * Premier tour : `plainte_initiale` du cas en message `user` (aligné Expo → /api/mobile/chat).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { HarnessUnavailableError, sendHarnessTurn, type HarnaisMode } from './harness-client.js';
import { buildManifest, loadCasesForSplit } from './manifest.js';
import { MissingApiKeyError } from '../llm-client.js';
import { simulateInstallerReply, type AmCase, type SimTurn } from '../sim/simulator.js';

const AM_ROOT = resolve(import.meta.dirname, '..');
const HVAC_BENCH_ROOT = resolve(AM_ROOT, '..');
const T_MAX = 12;

const ARM_TO_MODE: Record<string, HarnaisMode> = { L0: 'l0', LW: 'lw', PROD: 'prod' };

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function parseArgs() {
  const arm = arg('arm') ?? 'PROD';
  const split = (arg('split') ?? 'dev') as 'dev' | 'gate';
  const replicates = Number(arg('replicates') ?? '3');
  const casesFilter = arg('cases')?.split(',').map((s) => s.trim());
  const baseUrl = arg('base-url') ?? process.env.AM_HARNESS_URL ?? 'http://localhost:3000/api/mobile/chat';

  if (!['L0', 'LW', 'PROD'].includes(arm)) {
    throw new Error(`--arm invalide: ${arm} (attendu L0|LW|PROD)`);
  }
  if (!['dev', 'gate'].includes(split)) {
    throw new Error(`--split invalide: ${split} (attendu dev|gate)`);
  }
  return { arm: arm as 'L0' | 'LW' | 'PROD', split, replicates, casesFilter, baseUrl };
}

type TranscriptTurn = { role: 'technicien' | 'installateur'; content: string };
type TranscriptRecord = {
  case_id: string;
  replicate: number;
  turns: TranscriptTurn[];
  status: 'completed' | 'blocked' | 'error';
  blocked_reason?: string;
};

/** Historique UIMessage simplifié pour /api/mobile/chat — plainte initiale toujours en tête (comme Expo). */
function buildHarnessMessages(
  plainteInitiale: string,
  simHistory: SimTurn[],
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
    { role: 'user', content: plainteInitiale },
  ];
  for (const t of simHistory) {
    messages.push({
      role: t.role === 'technicien' ? 'assistant' : 'user',
      content: t.content,
    });
  }
  return messages;
}

async function playCase(
  amCase: AmCase & { id: string },
  replicate: number,
  args: ReturnType<typeof parseArgs>,
  bearerToken: string,
): Promise<TranscriptRecord> {
  const chatId = randomUUID();
  const turns: TranscriptTurn[] = [];
  const harnaisMode = ARM_TO_MODE[args.arm];
  const plainteInitiale = amCase.plainte_initiale.trim();
  if (!plainteInitiale) {
    return {
      case_id: amCase.id,
      replicate,
      turns,
      status: 'error',
      blocked_reason: 'plainte_initiale vide sur le cas',
    };
  }

  turns.push({ role: 'installateur', content: plainteInitiale });

  let technicienMessage: string;
  try {
    technicienMessage = await sendHarnessTurn({
      baseUrl: args.baseUrl,
      bearerToken,
      chatId,
      harnaisMode,
      modelId: process.env.AM_HARNESS_MODEL_ID ?? 'fast-marcel',
      messages: buildHarnessMessages(plainteInitiale, []),
    });
  } catch (e) {
    if (e instanceof HarnessUnavailableError) {
      return { case_id: amCase.id, replicate, turns, status: 'blocked', blocked_reason: e.message };
    }
    throw e;
  }
  turns.push({ role: 'technicien', content: technicienMessage });

  const simHistory: SimTurn[] = [];
  for (let tour = 0; tour < T_MAX; tour++) {
    let installerReply: string;
    try {
      const result = await simulateInstallerReply({
        amCase,
        history: simHistory,
        technicianMessage: technicienMessage,
      });
      installerReply = result.reply;
    } catch (e) {
      if (e instanceof MissingApiKeyError) {
        return { case_id: amCase.id, replicate, turns, status: 'blocked', blocked_reason: e.message };
      }
      throw e;
    }
    turns.push({ role: 'installateur', content: installerReply });
    simHistory.push({ role: 'technicien', content: technicienMessage });
    simHistory.push({ role: 'installateur', content: installerReply });

    try {
      technicienMessage = await sendHarnessTurn({
        baseUrl: args.baseUrl,
        bearerToken,
        chatId,
        harnaisMode,
        modelId: process.env.AM_HARNESS_MODEL_ID ?? 'fast-marcel',
        messages: buildHarnessMessages(plainteInitiale, simHistory),
      });
    } catch (e) {
      if (e instanceof HarnessUnavailableError) {
        return { case_id: amCase.id, replicate, turns, status: 'blocked', blocked_reason: e.message };
      }
      throw e;
    }
    turns.push({ role: 'technicien', content: technicienMessage });
  }

  return { case_id: amCase.id, replicate, turns, status: 'completed' };
}

async function main() {
  const args = parseArgs();
  const bearerToken = process.env.AM_HARNESS_BEARER_TOKEN;

  const runId = `am-${args.arm.toLowerCase()}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const manifest = buildManifest({ runId, arm: args.arm, split: args.split, replicates: args.replicates });

  const runsDir = resolve(HVAC_BENCH_ROOT, 'runs', runId);
  mkdirSync(runsDir, { recursive: true });
  writeFileSync(resolve(runsDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`Manifest écrit: ${resolve(runsDir, 'manifest.json')}`);
  console.log(JSON.stringify(manifest, null, 2));

  if (!bearerToken) {
    console.error(
      '\n🚫 AM_HARNESS_BEARER_TOKEN non défini — impossible d\'appeler /api/mobile/chat (auth requise côté WebApp).',
    );
    console.error('Manifest et arborescence de run tout de même écrits (preuve de la plomberie). Arrêt propre.');
    process.exit(2);
  }

  const cases = loadCasesForSplit(args.split)
    .map(({ content }) => JSON.parse(content) as AmCase & { id: string })
    .filter((c) => !args.casesFilter || args.casesFilter.includes(c.id));

  if (cases.length === 0) {
    console.error(`Aucun cas trouvé pour split=${args.split}${args.casesFilter ? ` (filtre: ${args.casesFilter})` : ''}.`);
    process.exit(1);
  }

  const rawPath = resolve(runsDir, 'raw.jsonl');
  const records: TranscriptRecord[] = [];

  for (const c of cases) {
    for (let r = 1; r <= args.replicates; r++) {
      const record = await playCase(c, r, args, bearerToken);
      records.push(record);
      writeFileSync(rawPath, records.map((rec) => JSON.stringify(rec)).join('\n') + '\n');
      console.log(`${record.status === 'completed' ? '✅' : '⚠️ '} ${c.id} réplicat ${r}: ${record.status}${record.blocked_reason ? ` — ${record.blocked_reason}` : ''}`);
    }
  }

  const completed = records.filter((r) => r.status === 'completed').length;
  console.log(`\n${completed}/${records.length} runs complets. Transcripts: ${rawPath}`);
  if (completed === 0) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
