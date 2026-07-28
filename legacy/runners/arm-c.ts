/**
 * Runner bras C — MCP AskMarcel (`tools/call` diagnose).
 *
 * Usage :
 *   BENCH_API_URL=… BENCH_API_KEY=… tsx runners/arm-c.ts --cases full --out runs/<run_id>
 *
 * Appelle POST /api/mcp (JSON-RPC), mappe vers Answer Contract pour le scorer.
 * Voir prompts/arm-c-v1.md — outil `diagnose` seul (v1).
 */
import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { BenchCase, ConfidenceBand, RunRecord } from '../scorer/types.js';
import { BENCH_FULL_PATHS, loadCases, loadCasesFromPaths, newRunId } from './lib.js';
import { mapMcpDiagnoseToAnswer, parseMcpDiagnoseResult } from './mcp-map.js';

const CONCURRENCY = Number(process.env.BENCH_CONCURRENCY ?? 2);
const TIMEOUT_MS = Number(process.env.BENCH_TIMEOUT_MS ?? 90_000);
const MAX_ATTEMPTS = 3;
const PROMPT_VERSION = 'arm-c-v1';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function parseBand(raw: string | null): ConfidenceBand {
  if (raw === 'high' || raw === 'medium' || raw === 'low') return raw;
  return 'unknown';
}

function buildMcpArgs(c: BenchCase): Record<string, string> {
  const args: Record<string, string> = { query: c.prompt.user_message };
  if (c.prompt.brand_hint) args.brand = c.prompt.brand_hint;
  if (c.prompt.model_hint) args.model = c.prompt.model_hint;
  if (c.prompt.error_code_hint) args.error_code = c.prompt.error_code_hint;
  return args;
}

async function callOnce(mcpUrl: string, apiKey: string, c: BenchCase): Promise<{ record: RunRecord; retryable: boolean }> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(mcpUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'X-AM-Key': apiKey,
        'Accept-Language': c.locale === 'en' ? 'en' : 'fr',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: c.id,
        method: 'tools/call',
        params: { name: 'diagnose', arguments: buildMcpArgs(c) },
      }),
      signal: controller.signal,
    });

    const latency = Date.now() - started;
    const text = await response.text();
    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      return {
        record: {
          case_id: c.id,
          arm: 'C',
          http_status: response.status,
          latency_ms: latency,
          answer: null,
          confidence: { band: 'unknown', score: null },
          error: `réponse MCP non JSON (${text.slice(0, 120)})`,
        },
        retryable: false,
      };
    }

    const rpc = payload as { error?: { message?: string } };
    if (rpc.error) {
      return {
        record: {
          case_id: c.id,
          arm: 'C',
          http_status: response.status,
          latency_ms: latency,
          answer: null,
          confidence: { band: 'unknown', score: null },
          error: `MCP error: ${rpc.error.message ?? 'unknown'}`,
        },
        retryable: response.status >= 500 || response.status === 429,
      };
    }

    const diagnostic = parseMcpDiagnoseResult(payload);
    if (!diagnostic) {
      return {
        record: {
          case_id: c.id,
          arm: 'C',
          http_status: response.status,
          latency_ms: latency,
          answer: null,
          confidence: { band: 'unknown', score: null },
          error: 'réponse diagnose MCP illisible',
        },
        retryable: false,
      };
    }

    const answer = mapMcpDiagnoseToAnswer(c, diagnostic);
    return {
      record: {
        case_id: c.id,
        arm: 'C',
        http_status: response.status,
        latency_ms: latency,
        answer,
        confidence: {
          band: parseBand(diagnostic.confidence.band),
          score: diagnostic.confidence.score,
        },
        error: response.ok ? null : `HTTP ${response.status}`,
      },
      retryable: response.status >= 500 || response.status === 429,
    };
  } catch (error) {
    return {
      record: {
        case_id: c.id,
        arm: 'C',
        http_status: null,
        latency_ms: Date.now() - started,
        answer: null,
        confidence: { band: 'unknown', score: null },
        error: error instanceof Error ? error.message : String(error),
      },
      retryable: true,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function callWithRetry(mcpUrl: string, apiKey: string, c: BenchCase): Promise<RunRecord> {
  let last: RunRecord | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const { record, retryable } = await callOnce(mcpUrl, apiKey, c);
    last = record;
    if (!retryable) return record;
    if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)));
  }
  return last as RunRecord;
}

async function main() {
  const baseUrl = process.env.BENCH_API_URL;
  const apiKey = process.env.BENCH_API_KEY;
  if (!baseUrl || !apiKey) {
    console.error('Définir BENCH_API_URL et BENCH_API_KEY.');
    process.exit(1);
  }

  const casesArg = arg('cases');
  const casesPath =
    casesArg === 'full' ? BENCH_FULL_PATHS.join(',') : casesArg ?? '../hvac-bench-heldout/dataset/gate.jsonl';
  const cases =
    casesPath.includes(',') ? loadCasesFromPaths(casesPath.split(',')) : loadCases(casesPath);
  const raw = cases.map((c) => JSON.stringify(c)).join('\n');

  const runId = arg('run-id') ?? newRunId('c');
  const outDir = resolve(arg('out') ?? `runs/${runId}`);
  mkdirSync(outDir, { recursive: true });
  const rawPath = resolve(outDir, 'raw.jsonl');
  writeFileSync(rawPath, '', 'utf8');

  const mcpUrl = `${baseUrl.replace(/\/$/, '')}/api/mcp`;
  const startedAt = new Date().toISOString();
  console.log(`Bras C (MCP diagnose) · ${cases.length} cas · ${mcpUrl}\nprompt ${PROMPT_VERSION}\nrun ${runId}\n`);

  let done = 0;
  let contractVersion: string | null = null;
  const queue = [...cases];

  const worker = async () => {
    for (;;) {
      const c = queue.shift();
      if (!c) return;
      const record = await callWithRetry(mcpUrl, apiKey, c);
      if (!contractVersion && record.answer && typeof record.answer.contract_version === 'string') {
        contractVersion = record.answer.contract_version;
      }
      appendFileSync(rawPath, `${JSON.stringify(record)}\n`, 'utf8');
      done += 1;
      const status = record.error ? `ERREUR` : `${record.http_status}`;
      process.stdout.write(`  [${String(done).padStart(3)}/${cases.length}] ${c.id} ${status}\n`);
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, cases.length) }, worker));

  const artifact = {
    run_id: runId,
    arm: 'C',
    contract_version: contractVersion,
    dataset_version: createHash('sha256').update(raw).digest('hex').slice(0, 16),
    index_version: null,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    endpoint: `${mcpUrl} · tools/call diagnose · ${PROMPT_VERSION}`,
    n: cases.length,
  };
  writeFileSync(resolve(outDir, 'run.json'), JSON.stringify(artifact, null, 2), 'utf8');
  console.log(`\n→ ${rawPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
