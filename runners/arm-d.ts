/**
 * Runner bras D — le pipeline de production (CDC §6).
 *
 * Usage :
 *   BENCH_API_URL=https://… BENCH_API_KEY=… \
 *   tsx runners/arm-d.ts --cases ../hvac-bench-heldout/dataset/gate.jsonl --out runs/<run_id>
 *
 * Le bras D interroge l'API réelle avec le prompt système de production : c'est le produit
 * qu'on mesure, pas un modèle prompté. L'asymétrie avec A/B/C est assumée par le CDC.
 *
 * Deux garde-fous importants :
 *  - un run pré-correctif n'a qu'une seule chance : l'artefact brut est écrit au fil de l'eau,
 *    un plantage à mi-parcours ne perd donc pas les cas déjà joués ;
 *  - la confiance vient de l'en-tête X-AM-Confidence-Band. Si elle manque, on enregistre
 *    `unknown` plutôt que de supposer `low` : le scorer signalera que la règle gate
 *    « high sur no-answer » ne couvre pas ces cas.
 */
import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { BenchCase, ConfidenceBand, RunArtifact, RunRecord } from '../scorer/types.js';

const CONCURRENCY = Number(process.env.BENCH_CONCURRENCY ?? 4);
const TIMEOUT_MS = Number(process.env.BENCH_TIMEOUT_MS ?? 45_000);
const MAX_ATTEMPTS = 3;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function parseBand(raw: string | null): ConfidenceBand {
  if (raw === 'high' || raw === 'medium' || raw === 'low') return raw;
  return 'unknown';
}

/**
 * Traduit un cas en paramètres d'appel. Les indices du cas sont transmis tels quels :
 * c'est précisément ce qui fait le piège des cas cross_attribution, où marque et code
 * sont cohérents en apparence mais ne vont pas ensemble.
 */
function buildPayload(c: BenchCase) {
  return {
    symptom: c.prompt.user_message,
    brand: c.prompt.brand_hint ?? undefined,
    model: c.prompt.model_hint ?? undefined,
    error_code: c.prompt.error_code_hint ?? undefined,
    lang: c.locale === 'en' ? 'en' : 'fr',
  };
}

async function callOnce(
  endpoint: string,
  apiKey: string,
  c: BenchCase,
): Promise<{ record: RunRecord; retryable: boolean }> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

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
      // Un corps illisible est un échec de format, pas une absence de mesure (REQ-O2).
      parseError = `réponse non JSON (${text.slice(0, 120)})`;
    }

    const scoreHeader = response.headers.get('X-AM-Confidence-Score');
    return {
      record: {
        case_id: c.id,
        arm: 'D',
        http_status: response.status,
        latency_ms: latency,
        answer,
        confidence: {
          band: parseBand(response.headers.get('X-AM-Confidence-Band')),
          score: scoreHeader === null ? null : Number(scoreHeader),
        },
        error: parseError,
      },
      retryable: response.status >= 500 || response.status === 429,
    };
  } catch (error) {
    return {
      record: {
        case_id: c.id,
        arm: 'D',
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

async function callWithRetry(endpoint: string, apiKey: string, c: BenchCase): Promise<RunRecord> {
  let last: RunRecord | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const { record, retryable } = await callOnce(endpoint, apiKey, c);
    last = record;
    if (!retryable) return record;
    if (attempt < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)));
    }
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

  const casesPath = resolve(arg('cases') ?? '../hvac-bench-heldout/dataset/gate.jsonl');
  const raw = readFileSync(casesPath, 'utf8');
  const cases = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as BenchCase);

  const runId = arg('run-id') ?? `d-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const outDir = resolve(arg('out') ?? `runs/${runId}`);
  mkdirSync(outDir, { recursive: true });
  const rawPath = resolve(outDir, 'raw.jsonl');
  writeFileSync(rawPath, '', 'utf8');

  const endpoint = `${baseUrl.replace(/\/$/, '')}/api/v1/assist/diagnose`;
  const startedAt = new Date().toISOString();
  console.log(`Bras D · ${cases.length} cas · ${endpoint}\nrun ${runId}\n`);

  let done = 0;
  let contractVersion: string | null = null;
  const queue = [...cases];

  const worker = async () => {
    for (;;) {
      const c = queue.shift();
      if (!c) return;
      const record = await callWithRetry(endpoint, apiKey, c);
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

  const artifact: RunArtifact = {
    run_id: runId,
    arm: 'D',
    contract_version: contractVersion,
    dataset_version: createHash('sha256').update(raw).digest('hex').slice(0, 16),
    index_version: null,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    endpoint,
    n: cases.length,
  };
  writeFileSync(resolve(outDir, 'run.json'), JSON.stringify(artifact, null, 2), 'utf8');

  console.log(`\n→ ${rawPath}\n→ ${resolve(outDir, 'run.json')}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
