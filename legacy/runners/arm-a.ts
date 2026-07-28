/**
 * Runner bras A — LLM closed-book (CDC §6).
 *
 * Usage :
 *   BENCH_ARM_A_API_KEY=… tsx runners/arm-a.ts \
 *     --cases ../hvac-bench-heldout/dataset/gate.jsonl --out runs/<run_id>
 *
 * Variables :
 *   BENCH_ARM_A_API_KEY — clé OpenAI-compatible (défaut : OPENROUTER_API_KEY puis OPENAI_API_KEY)
 *   BENCH_ARM_A_BASE_URL — défaut https://openrouter.ai/api/v1
 *   BENCH_ARM_A_MODEL — défaut deepseek/deepseek-v4-flash (config/models-v2.json)
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { BenchCase, RunRecord } from '../scorer/types.js';
import {
  arg,
  BENCH_FULL_PATHS,
  buildUserMessage,
  extractConfidence,
  extractJson,
  loadCases,
  loadCasesFromPaths,
  makeRunArtifact,
  newRunId,
  resolveOpenRouterArmConfig,
  stripBenchFields,
} from './lib.js';

const CONCURRENCY = Number(process.env.BENCH_CONCURRENCY ?? 3);
const TIMEOUT_MS = Number(process.env.BENCH_TIMEOUT_MS ?? 60_000);
const MAX_ATTEMPTS = 3;
const PROMPT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../prompts/arm-a-v1.md');

async function callOnce(
  config: ReturnType<typeof resolveOpenRouterArmConfig>,
  systemPrompt: string,
  c: BenchCase,
): Promise<{ record: RunRecord; retryable: boolean }> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
        ...(config.baseUrl.includes('openrouter.ai')
          ? {
              'HTTP-Referer': 'https://github.com/askmarcel/hvac-bench',
              'X-Title': config.title,
            }
          : {}),
      },
      body: JSON.stringify({
        model: config.model,
        temperature: config.temperature,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: buildUserMessage(c) },
        ],
      }),
      signal: controller.signal,
    });

    const latency = Date.now() - started;
    const text = await response.text();
    let payload: Record<string, unknown> | null = null;
    try {
      payload = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    } catch {
      return {
        record: {
          case_id: c.id,
          arm: 'A',
          http_status: response.status,
          latency_ms: latency,
          answer: null,
          confidence: { band: 'unknown', score: null },
          error: `réponse provider non JSON (${text.slice(0, 120)})`,
        },
        retryable: response.status >= 500 || response.status === 429,
      };
    }

    const choice = (payload?.choices as Array<{ message?: { content?: string } }> | undefined)?.[0];
    const content = choice?.message?.content ?? '';
    const parsed = extractJson(content);
    if (!parsed) {
      return {
        record: {
          case_id: c.id,
          arm: 'A',
          http_status: response.status,
          latency_ms: latency,
          answer: null,
          confidence: { band: 'unknown', score: null },
          error: `JSON invalide (${content.slice(0, 120)})`,
        },
        retryable: false,
      };
    }

    const confidence = extractConfidence(parsed);
    return {
      record: {
        case_id: c.id,
        arm: 'A',
        http_status: response.status,
        latency_ms: latency,
        answer: stripBenchFields(parsed),
        confidence,
        error: response.ok ? null : `provider HTTP ${response.status}`,
      },
      retryable: response.status >= 500 || response.status === 429,
    };
  } catch (error) {
    return {
      record: {
        case_id: c.id,
        arm: 'A',
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

async function callWithRetry(
  config: ReturnType<typeof resolveOpenRouterArmConfig>,
  systemPrompt: string,
  c: BenchCase,
): Promise<RunRecord> {
  let last: RunRecord | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const { record, retryable } = await callOnce(config, systemPrompt, c);
    last = record;
    if (!retryable && !record.error) return record;
    if (!retryable) return record;
    if (attempt < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, 800 * 2 ** (attempt - 1)));
    }
  }
  return last as RunRecord;
}

async function main() {
  const config = resolveOpenRouterArmConfig('A');
  const casesArg = arg('cases');
  const casesPath =
    casesArg === 'full' ? BENCH_FULL_PATHS.join(',') : casesArg ?? '../hvac-bench-heldout/dataset/gate.jsonl';
  const cases =
    casesPath.includes(',') ? loadCasesFromPaths(casesPath.split(',')) : loadCases(casesPath);
  const systemPrompt = readFileSync(PROMPT_PATH, 'utf8');

  const runId = arg('run-id') ?? newRunId('a');
  const outDir = resolve(arg('out') ?? `runs/${runId}`);
  mkdirSync(outDir, { recursive: true });
  const rawPath = resolve(outDir, 'raw.jsonl');
  writeFileSync(rawPath, '', 'utf8');

  const startedAt = new Date().toISOString();
  const endpoint = `${config.baseUrl} · ${config.model}`;
  console.log(`Bras A · ${cases.length} cas · ${endpoint}\nrun ${runId}\n`);

  let done = 0;
  let contractVersion: string | null = null;
  const queue = [...cases];

  const worker = async () => {
    for (;;) {
      const c = queue.shift();
      if (!c) return;
      const record = await callWithRetry(config, systemPrompt, c);
      if (!contractVersion && record.answer && typeof record.answer.contract_version === 'string') {
        contractVersion = record.answer.contract_version;
      }
      appendFileSync(rawPath, `${JSON.stringify(record)}\n`, 'utf8');
      done += 1;
      const status = record.error ? `ERREUR ${record.error.slice(0, 40)}` : `${record.http_status}`;
      process.stdout.write(`  [${String(done).padStart(3)}/${cases.length}] ${c.id} ${status}\n`);
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, cases.length) }, worker));

  const artifact = makeRunArtifact({
    runId,
    arm: 'A',
    casesPath,
    endpoint,
    n: cases.length,
    startedAt,
    contractVersion,
  });
  artifact.finished_at = new Date().toISOString();
  writeFileSync(resolve(outDir, 'run.json'), JSON.stringify(artifact, null, 2), 'utf8');

  console.log(`\n→ ${rawPath}\n→ ${resolve(outDir, 'run.json')}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
