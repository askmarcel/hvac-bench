/**
 * Audit échantillon repli pseudo-hypothèses → canoniques.
 * Usage: NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... pnpm exec tsx scripts/audit-hypothesis-fold.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';

import { mapTextToCanonical } from '../../../AskMarcel-WebApp-NextJS/lib/diagnostic-v2/canonical-hypotheses';

const SAMPLE_SIZE = 200;

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const { data, error } = await supabase
    .from('diag_hypotheses')
    .select('hypothesis_id, label')
    .like('hypothesis_id', 'h_%')
    .limit(SAMPLE_SIZE);
  if (error) throw error;

  let rule = 0;
  let unknown = 0;
  const byCanonical = new Map<string, number>();

  for (const row of data ?? []) {
    const mapped = mapTextToCanonical(row.label);
    if (mapped.method === 'rule') rule++;
    else unknown++;
    byCanonical.set(mapped.hypothesis_id, (byCanonical.get(mapped.hypothesis_id) ?? 0) + 1);
  }

  const report = {
    sample_size: data?.length ?? 0,
    rule_mapped: rule,
    unknown: unknown,
    rule_rate: data?.length ? rule / data.length : 0,
    canonical_distribution: Object.fromEntries(byCanonical),
  };

  const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '../reports');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    resolve(outDir, `audit-hypothesis-fold-${new Date().toISOString().slice(0, 10)}.json`),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
