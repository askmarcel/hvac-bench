#!/usr/bin/env tsx
/**
 * am:run — T7. Boucle harnais (bras testé) ↔ simulateur d'installateur (T4) sur les
 * cas d'un split, N réplicats, jusqu'à 12 tours. Écrit un transcript rejouable par cas
 * + un manifest tracé au SHA WebApp près (leçon O6/O10).
 *
 * Usage: tsx am/runner/run-arm.ts --arm PROD --split dev --replicates 3 [--cases ham-0001,ham-0002]
 *
 * Prérequis pour une boucle réelle (T10+) :
 *  - WebApp checkout sibling (`../AskMarcel-WebApp-NextJS`) — in-process par défaut (CORE)
 *  - HTTP (`AM_HARNESS_TRANSPORT=http` + `--surface S1|S2|S3`) : tests transport T14 uniquement
 *  - `AM_HARNESS_BEARER_TOKEN` (JWT) requis seulement en transport HTTP
 *  - Clés simulateur (`AM_SIM_*`) — absentes en local volontairement, fournies en CI
 * Sans token ou serveur : échec propre par cas (`status: blocked`), jamais un faux succès.
 *
 * Premier tour : `plainte_initiale` du cas en message `user` (même entrée que les surfaces).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { HarnessUnavailableError, sendHarnessTurn, resolveHarnessBaseUrl, type HarnaisMode, type HarnessTurnResponse } from './harness-client.js';
import { getHarnessBearerToken, invalidateHarnessTokenCache, isJwtExpiredError } from './bench-auth.js';
import { buildManifest, loadCasesForSplit, assertWebappGitCleanForGate } from './manifest.js';
import { resolveHarnessModelId } from './harness-model-config.js';
import {
  enrichTurnFromHarnessResponse,
  isTerminalVerdict,
  type EnrichedTurnFields,
} from './transcript-enrich.js';
import { inferInstallerReading } from './transcript-parse.js';
import type { TranscriptRecord, TranscriptTurn } from './transcript-types.js';
import { MissingApiKeyError } from '../llm-client.js';
import { simulateInstallerReply, type AmCase, type SimTurn } from '../sim/simulator.js';
import type { RunVerdict } from '../scorer/mechanical.js';

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
  const replicateOnly = arg('replicate') ? Number(arg('replicate')) : undefined;
  const runDir = arg('run-dir');
  const casesFilter = arg('cases')?.split(',').map((s) => s.trim());
  const surface = (arg('surface') ?? process.env.AM_HARNESS_SURFACE ?? 'CORE') as
    | 'CORE'
    | 'S1'
    | 'S2'
    | 'S3';
  const baseUrl =
    arg('base-url') ??
    resolveHarnessBaseUrl(
      surface,
      surface !== 'CORE' && process.env.AM_HARNESS_URL?.includes('/api/')
        ? process.env.AM_HARNESS_URL
        : undefined,
    );

  if (!['L0', 'LW', 'PROD'].includes(arm)) {
    throw new Error(`--arm invalide: ${arm} (attendu L0|LW|PROD)`);
  }
  if (!['dev', 'gate'].includes(split)) {
    throw new Error(`--split invalide: ${split} (attendu dev|gate)`);
  }
  if (!['CORE', 'S1', 'S2', 'S3'].includes(surface)) {
    throw new Error(`--surface invalide: ${surface} (attendu CORE|S1|S2|S3)`);
  }
  if (replicateOnly !== undefined && (!Number.isInteger(replicateOnly) || replicateOnly < 1)) {
    throw new Error(`--replicate invalide: ${replicateOnly} (entier ≥ 1)`);
  }
  return {
    arm: arm as 'L0' | 'LW' | 'PROD',
    split,
    replicates,
    replicateOnly,
    runDir,
    casesFilter,
    baseUrl,
    surface,
  };
}

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

async function callHarnessTurn(
  args: Omit<Parameters<typeof sendHarnessTurn>[0], 'bearerToken'>,
): Promise<HarnessTurnResponse> {
  const http =
    args.surface !== 'CORE' && process.env.AM_HARNESS_TRANSPORT === 'http';
  if (!http) {
    return sendHarnessTurn(args);
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const bearerToken = await getHarnessBearerToken();
    try {
      return await sendHarnessTurn({ ...args, bearerToken });
    } catch (e) {
      if (
        attempt === 0 &&
        e instanceof HarnessUnavailableError &&
        isJwtExpiredError(e.message)
      ) {
        invalidateHarnessTokenCache();
        console.warn('⚠️  JWT expiré — refresh et nouvel essai…');
        continue;
      }
      throw e;
    }
  }
  throw new Error('callHarnessTurn: unreachable');
}

function pushTechnicienTurn(
  turns: TranscriptTurn[],
  response: HarnessTurnResponse,
  enriched: EnrichedTurnFields & { verdict?: RunVerdict | null },
): RunVerdict | null {
  turns.push({
    role: 'technicien',
    content: response.text,
    action_id: enriched.action_id,
    plages_annoncees: enriched.plages_annoncees,
    finish_reason: enriched.finish_reason,
    warnings: enriched.warnings,
  });
  return enriched.verdict ?? null;
}

function harnessModelId(): string {
  return resolveHarnessModelId();
}

function plageConditionFromCase(amCase: AmCase & { id: string }): string | undefined {
  const emetteur = amCase.installation?.emetteur;
  return typeof emetteur === 'string' && emetteur.length > 0 ? emetteur : undefined;
}

async function playCase(
  amCase: AmCase & { id: string },
  replicate: number,
  args: ReturnType<typeof parseArgs>,
): Promise<TranscriptRecord> {
  const chatId = randomUUID();
  const turns: TranscriptTurn[] = [];
  let verdict: RunVerdict | null = null;
  const harnaisMode = ARM_TO_MODE[args.arm];
  const plainteInitiale = amCase.plainte_initiale.trim();
  if (!plainteInitiale) {
    return {
      case_id: amCase.id,
      replicate,
      turns,
      verdict: null,
      status: 'error',
      blocked_reason: 'plainte_initiale vide sur le cas',
    };
  }

  turns.push({ role: 'installateur', content: plainteInitiale });

  try {
    const firstResponse = await callHarnessTurn({
      baseUrl: args.baseUrl,
      chatId,
      harnaisMode,
      modelId: harnessModelId(),
      messages: buildHarnessMessages(plainteInitiale, []),
      surface: args.surface,
      diagnosticContext: amCase.equipement?.marque
        ? {
            brandName: amCase.equipement.marque,
            modelName: amCase.equipement.modele,
          }
        : null,
    });
    const enriched = enrichTurnFromHarnessResponse(firstResponse, {
      plageCondition: plageConditionFromCase(amCase),
    });
    const turnVerdict = pushTechnicienTurn(turns, firstResponse, enriched);
    if (turnVerdict) verdict = turnVerdict;
    if (isTerminalVerdict(verdict)) {
      return { case_id: amCase.id, replicate, turns, verdict, status: 'completed' };
    }
  } catch (e) {
    if (e instanceof HarnessUnavailableError) {
      return {
        case_id: amCase.id,
        replicate,
        turns,
        verdict: null,
        status: 'blocked',
        blocked_reason: e.message,
      };
    }
    throw e;
  }

  const simHistory: SimTurn[] = [];
  let technicienMessage = turns[turns.length - 1]!.content;

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
        return {
          case_id: amCase.id,
          replicate,
          turns,
          verdict,
          status: 'blocked',
          blocked_reason: e.message,
        };
      }
      throw e;
    }
    const installerTurn: TranscriptTurn = { role: 'installateur', content: installerReply };
    const reading = inferInstallerReading(
      technicienMessage,
      installerReply,
      amCase.ground_state,
    );
    if (reading) installerTurn.reading = reading;
    turns.push(installerTurn);
    simHistory.push({ role: 'technicien', content: technicienMessage });
    simHistory.push({ role: 'installateur', content: installerReply });

    try {
      const response = await callHarnessTurn({
        baseUrl: args.baseUrl,
        chatId,
        harnaisMode,
        modelId: harnessModelId(),
        messages: buildHarnessMessages(plainteInitiale, simHistory),
        surface: args.surface,
        diagnosticContext: amCase.equipement?.marque
          ? {
              brandName: amCase.equipement.marque,
              modelName: amCase.equipement.modele,
            }
          : null,
      });
      const enriched = enrichTurnFromHarnessResponse(response, {
        plageCondition: plageConditionFromCase(amCase),
      });
      const turnVerdict = pushTechnicienTurn(turns, response, enriched);
      if (turnVerdict) verdict = turnVerdict;
      technicienMessage = response.text;
      if (isTerminalVerdict(verdict)) {
        break;
      }
    } catch (e) {
      if (e instanceof HarnessUnavailableError) {
        return {
          case_id: amCase.id,
          replicate,
          turns,
          verdict,
          status: 'blocked',
          blocked_reason: e.message,
        };
      }
      throw e;
    }
  }

  return { case_id: amCase.id, replicate, turns, verdict, status: 'completed' };
}

async function main() {
  const args = parseArgs();
  assertWebappGitCleanForGate(args.split);
  const transport =
    args.surface !== 'CORE' && process.env.AM_HARNESS_TRANSPORT === 'http' ? 'http' : 'in-process';
  console.log(`Harnais: ${args.surface} · transport: ${transport}`);

  if (transport === 'http') {
    try {
      await getHarnessBearerToken();
    } catch (e) {
      if (!process.env.AM_HARNESS_BEARER_TOKEN) {
        console.error('\n🚫 JWT bench indisponible pour transport HTTP.');
        console.error((e as Error).message);
        process.exit(2);
      }
    }
  }

  const runId = args.runDir
    ? resolve(args.runDir).split('/').pop()!
    : `am-${args.arm.toLowerCase()}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const manifest = buildManifest({
    runId,
    arm: args.arm,
    split: args.split,
    replicates: args.replicates,
    surface: args.surface,
  });

  const runsDir = args.runDir ? resolve(args.runDir) : resolve(HVAC_BENCH_ROOT, 'runs', runId);
  mkdirSync(runsDir, { recursive: true });
  if (!args.runDir) {
    writeFileSync(resolve(runsDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  }
  console.log(`Manifest écrit: ${resolve(runsDir, 'manifest.json')}`);
  console.log(JSON.stringify(manifest, null, 2));

  const cases = loadCasesForSplit(args.split)
    .map(({ content }) => JSON.parse(content) as AmCase & { id: string })
    .filter((c) => !args.casesFilter || args.casesFilter.includes(c.id));

  if (cases.length === 0) {
    console.error(`Aucun cas trouvé pour split=${args.split}${args.casesFilter ? ` (filtre: ${args.casesFilter})` : ''}.`);
    process.exit(1);
  }

  const rawPath = resolve(runsDir, 'raw.jsonl');
  const existingRecords: TranscriptRecord[] = existsSync(rawPath)
    ? readFileSync(rawPath, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as TranscriptRecord)
    : [];
  const records: TranscriptRecord[] = [...existingRecords];

  const replicateRange = () => {
    if (args.replicateOnly !== undefined) return [args.replicateOnly];
    return Array.from({ length: args.replicates }, (_, i) => i + 1);
  };

  for (const c of cases) {
    for (const r of replicateRange()) {
      const record = await playCase(c, r, args);
      const idx = records.findIndex((rec) => rec.case_id === c.id && rec.replicate === r);
      if (idx >= 0) records[idx] = record;
      else records.push(record);
      writeFileSync(rawPath, records.map((rec) => JSON.stringify(rec)).join('\n') + '\n');
      console.log(`${record.status === 'completed' ? '✅' : '⚠️ '} ${c.id} réplicat ${r}: ${record.status}${record.blocked_reason ? ` — ${record.blocked_reason}` : ''}`);
    }
  }

  const completed = records.filter((r) => r.status === 'completed').length;
  const blocked = records.filter((r) => r.status === 'blocked').length;
  console.log(`\n${completed}/${records.length} runs complets (${blocked} blocked). Transcripts: ${rawPath}`);
  if (completed === 0) process.exit(2);
  if (blocked > 0) {
    console.error(`\n🚫 G0 : ${blocked}/${records.length} blocked — run invalide.`);
    process.exit(2);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
