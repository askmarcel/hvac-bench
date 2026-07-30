/**
 * Client vers le harnais réel — D3 : appel direct `runHarnaisTurn` via subprocess
 * (scripts/bench-harnais-turn.ts), sans HTTP/SSE. Fallback HTTP si
 * AM_HARNESS_TRANSPORT=http.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { extractHarnessTurnText } from './stream-text-extract.js';

export class HarnessUnavailableError extends Error {
  constructor(cause: string) {
    super(`Harnais injoignable (${cause}). WebApp .env + clés LLM ?`);
    this.name = 'HarnessUnavailableError';
  }
}

export type HarnaisMode = 'l0' | 'lw' | 'prod';

/** CORE = cœur harnais (`runHarnaisTurn` via bench-harnais-turn). S1–S3 = routes HTTP (T14). */
export type HarnessSurface = 'CORE' | 'S1' | 'S2' | 'S3';

export const SURFACE_HTTP_PATHS: Record<Exclude<HarnessSurface, 'CORE'>, string> = {
  S1: '/api/chat',
  S2: '/api/mobile/chat',
  S3: '/api/v1/chat/stream',
};

export type HarnessTurnArgs = {
  baseUrl: string;
  bearerToken?: string;
  chatId: string;
  harnaisMode: HarnaisMode;
  modelId: string;
  /** Historique complet — doit contenir au moins un message `user` (plainte initiale). */
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  diagnosticContext?: Record<string, unknown> | null;
  locale?: string;
  surface?: HarnessSurface;
};

export type HarnessStepSnapshot = {
  text: string;
  toolCalls: Array<{ toolName: string; input?: unknown }>;
  toolResults?: Array<{ toolName: string; output?: unknown }>;
  finishReason?: string;
};

export type AcceptedDiagnosticSnapshot = {
  accepted: true;
  verdict: 'conclusion' | 'escalade';
  cause?: string;
  escalade?: { motif: string; detail: string };
  mesuresRecues?: Array<{ grandeur: string; valeur: string }>;
};

export type HarnessTurnResponse = {
  text: string;
  finishReason?: string;
  warnings: string[];
  steps?: HarnessStepSnapshot[];
  acceptedDiagnostic?: AcceptedDiagnosticSnapshot;
  openrouter?: {
    upstreamProvider: string | null;
    apiModelServed: string | null;
    providerMetadata: Record<string, unknown> | null;
  };
  errorDetail?: { message: string; name?: string; cause?: string; warnings: string[] };
};

type BenchStdoutPayload = {
  text?: string;
  error?: string;
  finishReason?: string;
  warnings?: string[];
  steps?: HarnessStepSnapshot[];
  acceptedDiagnostic?: AcceptedDiagnosticSnapshot;
  openrouter?: HarnessTurnResponse['openrouter'];
  errorDetail?: HarnessTurnResponse['errorDetail'];
};

const WEBAPP_ROOT = process.env.WEBAPP_REPO_PATH
  ? resolve(process.env.WEBAPP_REPO_PATH)
  : resolve(import.meta.dirname, '../../../AskMarcel-WebApp-NextJS');
const BENCH_SCRIPT = resolve(WEBAPP_ROOT, 'scripts/bench-harnais-turn.ts');

function resolveBenchSubprocess(): { command: string; args: string[] } {
  const localTsx = resolve(WEBAPP_ROOT, 'node_modules/.bin/tsx');
  if (existsSync(localTsx)) {
    return { command: localTsx, args: [BENCH_SCRIPT] };
  }
  const pnpm = process.env.PNPM_HOME ? join(process.env.PNPM_HOME, 'pnpm') : 'pnpm';
  return { command: pnpm, args: ['exec', 'tsx', BENCH_SCRIPT] };
}

export { serializeToolTurn } from './stream-text-extract.js';

export function resolveHarnessBaseUrl(surface: HarnessSurface, explicit?: string): string {
  if (surface === 'CORE') {
    return explicit ?? 'in-process://runHarnaisTurn';
  }
  if (explicit) return explicit;
  const host = process.env.AM_HARNESS_URL?.replace(/\/api\/.*$/, '') ?? 'http://localhost:3000';
  return `${host}${SURFACE_HTTP_PATHS[surface]}`;
}

function useHttpTransport(surface?: HarnessSurface): boolean {
  if (!surface || surface === 'CORE') return false;
  return process.env.AM_HARNESS_TRANSPORT === 'http';
}

function validateHarnessTurnResponse(parsed: BenchStdoutPayload): HarnessTurnResponse {
  if (parsed.error) {
    throw new HarnessUnavailableError(parsed.error);
  }

  const finishReason = parsed.finishReason;
  const warnings = parsed.warnings ?? [];

  if (finishReason === 'error' || finishReason === 'length') {
    const detail = [
      `finishReason=${finishReason}`,
      parsed.openrouter?.upstreamProvider
        ? `upstreamProvider=${parsed.openrouter.upstreamProvider}`
        : null,
      warnings.length > 0 ? `warnings=${warnings.join('; ')}` : null,
      parsed.errorDetail?.cause ? `cause=${parsed.errorDetail.cause}` : null,
    ]
      .filter(Boolean)
      .join('; ');
    throw new HarnessUnavailableError(detail || `finishReason=${finishReason}`);
  }

  if (!parsed.text?.trim()) {
    const detail = [
      'réponse vide du subprocess bench-harnais-turn',
      finishReason ? `finishReason=${finishReason}` : null,
      warnings.length > 0 ? `warnings=${warnings.join('; ')}` : null,
    ]
      .filter(Boolean)
      .join('; ');
    throw new HarnessUnavailableError(detail);
  }

  if (warnings.length > 0) {
    const rendered = warnings.map((w) => (typeof w === 'string' ? w : JSON.stringify(w))).join('; ');
    console.warn(`⚠️  harness turn warnings: ${rendered}`);
  }

  return {
    text: parsed.text,
    finishReason,
    warnings,
    steps: parsed.steps,
    acceptedDiagnostic: parsed.acceptedDiagnostic,
    openrouter: parsed.openrouter,
    errorDetail: parsed.errorDetail,
  };
}

function parseBenchStdout(stdout: string, stderr: string, code: number | null): HarnessTurnResponse {
  const trimmed = stdout.trim();
  let parsed: BenchStdoutPayload | null = null;
  try {
    parsed = JSON.parse(trimmed) as BenchStdoutPayload;
  } catch {
    const detail = [
      `JSON invalide (exit ${code ?? '?'})`,
      trimmed ? `stdout=${trimmed.slice(0, 200)}` : null,
      stderr ? `stderr=${stderr.slice(0, 200)}` : null,
    ]
      .filter(Boolean)
      .join('; ');
    throw new HarnessUnavailableError(detail);
  }

  if (code !== 0) {
    const detail = [
      parsed.error ?? `exit ${code}`,
      parsed.finishReason ? `finishReason=${parsed.finishReason}` : null,
      stderr ? `stderr=${stderr.slice(0, 200)}` : null,
    ]
      .filter(Boolean)
      .join('; ');
    throw new HarnessUnavailableError(detail);
  }

  return validateHarnessTurnResponse(parsed);
}

export async function sendHarnessTurnInProcess(args: HarnessTurnArgs): Promise<HarnessTurnResponse> {
  const payload = JSON.stringify({
    harnaisMode: args.harnaisMode,
    modelId: args.modelId,
    messages: args.messages,
    diagnosticContext: args.diagnosticContext ?? null,
    locale: args.locale ?? 'fr',
    telemetryFunctionId: `bench-${args.surface ?? 'core'}`,
  });

  return new Promise((resolvePromise, reject) => {
    const { command, args: spawnArgs } = resolveBenchSubprocess();
    const shim = resolve(import.meta.dirname, '../scripts/bench-server-only-shim.cjs');
    const nodeOptions = [
      process.env.NODE_OPTIONS ?? '',
      existsSync(shim) ? `--require ${shim}` : '',
    ]
      .filter(Boolean)
      .join(' ');
    const child = spawn(command, spawnArgs, {
      cwd: WEBAPP_ROOT,
      env: {
        ...process.env,
        AM_HARNESS_BENCH_MODE: 'true',
        ...(nodeOptions ? { NODE_OPTIONS: nodeOptions } : {}),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (e) => reject(new HarnessUnavailableError(e.message)));
    child.on('close', (code) => {
      try {
        resolvePromise(parseBenchStdout(stdout, stderr, code));
      } catch (e) {
        reject(e);
      }
    });

    child.stdin.write(payload);
    child.stdin.end();
  });
}

export async function sendHarnessTurnHttp(args: HarnessTurnArgs): Promise<HarnessTurnResponse> {
  if (!args.bearerToken) {
    throw new HarnessUnavailableError('bearerToken requis pour transport HTTP');
  }

  const body = {
    id: args.chatId,
    modelId: args.modelId,
    messages: args.messages.map((m, i) => ({
      id: `${args.chatId}-${i}`,
      role: m.role,
      parts: [{ type: 'text', text: m.content }],
    })),
    diagnosticContext: args.diagnosticContext ?? undefined,
  };

  let response: Response;
  try {
    response = await fetch(args.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${args.bearerToken}`,
        'x-bench-mode': '1',
        'x-harnais-mode': args.harnaisMode,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new HarnessUnavailableError((e as Error).message);
  }

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new HarnessUnavailableError(`HTTP ${response.status}: ${errBody.slice(0, 300)}`);
  }

  const raw = await response.text();
  const text = extractHarnessTurnText(raw);
  if (!text) {
    throw new HarnessUnavailableError('réponse reçue mais aucun texte extrait du flux');
  }
  return { text, warnings: [] };
}

/** Point d'entrée unifié — CORE in-process par défaut (D3 / O6). HTTP = surfaces T14 uniquement. */
export async function sendHarnessTurn(args: HarnessTurnArgs): Promise<HarnessTurnResponse> {
  if (useHttpTransport(args.surface)) {
    return sendHarnessTurnHttp(args);
  }
  return sendHarnessTurnInProcess(args);
}
