/**
 * Synchronise les priors des cas pilotes v2 depuis diag_priors Supabase.
 * Signature : hash(equipment_type, code) — sans symptom_cluster.
 * Usage: NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... pnpm exec tsx scripts/sync-pilot-priors.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';

import { buildSignature } from '../lib/signature.js';

type PilotCase = {
  id: string;
  symptom: { narrative: string; code_present: string | null };
  context: { equipment_type: string };
  hypotheses: Array<{
    id: string;
    label: string;
    prior: number;
    n_observations: number;
    window?: string;
    source?: string;
    true_cause: boolean;
  }>;
  flags: { sparse_priors: boolean };
  [key: string]: unknown;
};

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const pilotPath = resolve(dirname(fileURLToPath(import.meta.url)), '../dataset/pilot/pilot-v2.jsonl');
  const cases: PilotCase[] = readFileSync(pilotPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as PilotCase);

  let updated = 0;

  for (const c of cases) {
    const sig = buildSignature(c.context.equipment_type, c.symptom.code_present);

    const priors: Array<{
      hypothesis_id: string;
      prior: number;
      n_observations: number;
      window_start: string;
      window_end: string;
      diag_hypotheses: { label?: string } | null;
    }> = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const { data: page } = await supabase
        .from('diag_priors')
        .select('hypothesis_id, prior, n_observations, window_start, window_end, diag_hypotheses(label)')
        .eq('signature', sig)
        .range(from, from + pageSize - 1);
      if (!page?.length) break;
      priors.push(...(page as typeof priors));
      if (page.length < pageSize) break;
    }

    if (!priors || priors.length === 0) {
      c.flags.sparse_priors = true;
      for (const h of c.hypotheses) {
        if (!h.true_cause) continue;
        h.source = 'generic_physics';
        h.n_observations = 0;
      }
      console.log(`${c.id}: signature=${sig} — no priors (sparse)`);
      continue;
    }

    const totalN = priors.reduce((s, p) => s + p.n_observations, 0);
    c.flags.sparse_priors = totalN < 30;

    const priorMap = new Map(
      priors.map((p) => [
        p.hypothesis_id,
        {
          prior: Number(p.prior),
          n: p.n_observations,
          label: (p.diag_hypotheses as { label?: string } | null)?.label,
          window: `${p.window_start}..${p.window_end}`,
        },
      ]),
    );

    const window = priors[0] ? `${priors[0].window_start}..${priors[0].window_end}` : undefined;

    for (const h of c.hypotheses) {
      const mined = priorMap.get(h.id);
      if (mined) {
        h.prior = mined.prior;
        h.n_observations = mined.n;
        h.window = mined.window ?? window;
        h.source = 'resolution_corpus';
        if (mined.label) h.label = mined.label;
      } else if (!h.true_cause) {
        h.prior = Math.min(h.prior, 0.15);
        h.n_observations = 0;
        h.source = 'generic_physics';
      }
    }

    const sum = c.hypotheses.reduce((s, h) => s + h.prior, 0);
    if (sum > 0) {
      for (const h of c.hypotheses) {
        h.prior = h.prior / sum;
      }
    }

    updated++;
    console.log(`${c.id}: signature=${sig} priors=${priors.length} n_total=${totalN} sparse=${c.flags.sparse_priors}`);
  }

  writeFileSync(pilotPath, cases.map((c) => JSON.stringify(c)).join('\n') + '\n');
  console.log(`Updated ${updated}/${cases.length} cases with mined priors`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
