/**
 * Parité canonical ↔ Supabase diag_hypotheses (prod D API).
 *
 * Usage:
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... pnpm check:hypothesis-matrix-parity
 */
import { createClient } from '@supabase/supabase-js';

import {
  HYPOTHESIS_ACTIONS,
  matricesEqual,
  normalizeMatrixForSnapshot,
} from '../lib/hypothesis-matrix.js';

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const { data, error } = await supabase
    .from('diag_hypotheses')
    .select('hypothesis_id, discriminating_actions');
  if (error) throw error;

  const remote: Record<string, string[]> = {};
  for (const row of data ?? []) {
    remote[row.hypothesis_id] = (row.discriminating_actions as string[]) ?? [];
  }

  const local = normalizeMatrixForSnapshot(HYPOTHESIS_ACTIONS);
  const diffs = matricesEqual(local, remote);
  if (diffs.length) {
    console.error(`PARITY FAIL — ${diffs.length} hypothèses divergentes: ${diffs.join(', ')}`);
    console.error('Relancer: pnpm enrich:hypothesis-matrix');
    process.exit(1);
  }
  console.log(`PARITY OK — ${Object.keys(local).length} hypothèses alignées canonical ↔ Supabase`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
