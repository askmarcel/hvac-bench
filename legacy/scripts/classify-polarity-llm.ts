/**
 * Classifie les polarités ambiguës (neutral déclaré supports) via LLM — sortie CSV revue Marcel.
 *
 * Usage:
 *   OPENROUTER_API_KEY=... pnpm classify:polarity-llm
 *
 * Ne modifie pas pilot-v2.jsonl automatiquement.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { inferPolarity } from './audit-polarity.js';

type PilotCase = {
  id: string;
  symptom: { narrative: string };
  hypotheses: Array<{ id: string; true_cause?: boolean; label?: string }>;
  tests: Array<{
    action_id: string;
    observation: string;
    polarity?: string;
    discriminates: string[];
  }>;
};

async function classify(observation: string, context: string, apiKey: string): Promise<string> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'mistralai/mistral-small-3.1-24b-instruct',
      temperature: 0,
      messages: [
        {
          role: 'system',
          content:
            'Classifie la polarité diagnostique: supports, refutes, ou neutral. JSON strict: {"polarity":"..."}',
        },
        { role: 'user', content: context + '\nObservation: ' + observation },
      ],
    }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}`);
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const raw = data.choices?.[0]?.message?.content ?? '{}';
  const m = raw.match(/"polarity"\s*:\s*"(supports|refutes|neutral)"/);
  return m?.[1] ?? 'neutral';
}

async function main() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const dryRun = !apiKey;
  const pilotPath = resolve(import.meta.dirname, '../dataset/pilot/pilot-v2.jsonl');
  const cases: PilotCase[] = readFileSync(pilotPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as PilotCase);

  const rows: string[] = ['case_id,action_id,declared,inferred,llm_polarity,observation'];
  for (const c of cases) {
    for (const t of c.tests) {
      const inferred = inferPolarity(t.observation);
      const declared = t.polarity ?? 'supports';
      if (inferred !== 'neutral' || declared === 'neutral') continue;
      const trueCause = c.hypotheses.find((h) => h.true_cause)?.id ?? '';
      const context = `Cas ${c.id}. Symptôme: ${c.symptom.narrative}. Vraie cause: ${trueCause}. Action: ${t.action_id}.`;
      const llm = dryRun ? 'pending' : await classify(t.observation, context, apiKey);
      rows.push(
        [c.id, t.action_id, declared, inferred, llm, JSON.stringify(t.observation)].join(','),
      );
    }
  }

  const outPath = resolve(import.meta.dirname, '../workflow/polarity-review.csv');
  writeFileSync(outPath, rows.join('\n') + '\n');
  console.log(`Wrote ${rows.length - 1} rows to ${outPath}${dryRun ? ' (dry-run, pas de LLM)' : ''}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
