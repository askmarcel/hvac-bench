/**
 * Rejoue les cas en échec (429, timeout, etc.) et fusionne dans raw.jsonl.
 * Usage :
 *   set -a && source .env.bench && set +a
 *   tsx scripts/retry-failed-records.ts \
 *     --cases full --run runs/bench-v2-full-d-2026-07-26/raw.jsonl \
 *     --arm d --delay-ms 4000
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { BENCH_FULL_PATHS, loadCasesFromPaths } from '../runners/lib.js';
import type { BenchCase, RunRecord } from '../scorer/types.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function readJsonl<T>(path: string): T[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as T);
}

function isSuccess(r: RunRecord): boolean {
  return r.http_status === 200 && !r.error && r.answer !== null;
}

function buildPayload(c: BenchCase) {
  return {
    symptom: c.prompt.user_message,
    brand: c.prompt.brand_hint ?? undefined,
    model: c.prompt.model_hint ?? undefined,
    error_code: c.prompt.error_code_hint ?? undefined,
    lang: c.locale === 'en' ? 'en' : 'fr',
  };
}

function parseBand(raw: string | null): RunRecord['confidence']['band'] {
  if (raw === 'high' || raw === 'medium' || raw === 'low') return raw;
  return 'unknown';
}

async function callDiagnose(endpoint: string, apiKey: string, c: BenchCase): Promise<RunRecord> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.BENCH_TIMEOUT_MS ?? 90_000));
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-AM-Key': apiKey,
        Authorization: `Bearer ${apiKey}`,
        'Accept-Language': c.locale === 'en' ? 'en' : 'fr',
      },
      body: JSON.stringify(buildPayload(c)),
      signal: controller.signal,
    });
    const latency = Date.now() - started;
    const text = await response.text();
    let answer: Record<string, unknown> | null = null;
    let parseError: string | null = null;
    try {
      answer = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    } catch {
      parseError = `réponse non JSON (${text.slice(0, 120)})`;
    }
    return {
      case_id: c.id,
      arm: 'D',
      http_status: response.status,
      latency_ms: latency,
      answer,
      confidence: {
        band: parseBand(response.headers.get('X-AM-Confidence-Band')),
        score:
          response.headers.get('X-AM-Confidence-Score') === null
            ? null
            : Number(response.headers.get('X-AM-Confidence-Score')),
      },
      error: parseError,
    };
  } catch (error) {
    return {
      case_id: c.id,
      arm: 'D',
      http_status: null,
      latency_ms: Date.now() - started,
      answer: null,
      confidence: { band: 'unknown', score: null },
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const runPath = resolve(arg('run') ?? '');
  if (!runPath) {
    console.error('--run <raw.jsonl> requis.');
    process.exit(1);
  }
  const casesArg = arg('cases') ?? 'full';
  const paths = casesArg === 'full' ? BENCH_FULL_PATHS : [casesArg];
  const cases = loadCasesFromPaths(paths.map((p) => resolve(p)));
  const byCase = new Map(cases.map((c) => [c.id, c]));
  const records = readJsonl<RunRecord>(runPath);
  const byId = new Map(records.map((r) => [r.case_id, r]));

  const failed = cases.filter((c) => !isSuccess(byId.get(c.id) as RunRecord));
  if (failed.length === 0) {
    console.log('Aucun cas en échec.');
    return;
  }

  const baseUrl = process.env.BENCH_API_URL;
  const apiKey = process.env.BENCH_API_KEY;
  if (!baseUrl || !apiKey) {
    console.error('Définir BENCH_API_URL et BENCH_API_KEY.');
    process.exit(1);
  }
  const endpoint = `${baseUrl.replace(/\/$/, '')}/api/v1/assist/diagnose`;
  const delayMs = Number(arg('delay-ms') ?? 4000);

  console.log(`Retry ${failed.length} cas · délai ${delayMs} ms · ${endpoint}\n`);

  for (let i = 0; i < failed.length; i += 1) {
    const c = failed[i];
    const record = await callDiagnose(endpoint, apiKey, c);
    byId.set(c.id, record);
    const status = record.error ? `ERREUR ${record.error.slice(0, 40)}` : `${record.http_status}`;
    console.log(`  [${String(i + 1).padStart(3)}/${failed.length}] ${c.id} ${status}`);
    if (i < failed.length - 1) await new Promise((r) => setTimeout(r, delayMs));
  }

  const merged = cases.map((c) => byId.get(c.id)).filter(Boolean) as RunRecord[];
  writeFileSync(runPath, `${merged.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8');
  const ok = merged.filter(isSuccess).length;
  console.log(`\n→ ${runPath} (${ok}/${cases.length} succès)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
