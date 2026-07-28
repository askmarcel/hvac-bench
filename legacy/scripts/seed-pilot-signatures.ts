/**
 * Bras D* — alimente diag_priors pour signatures pilote (priors assistés par oracle).
 *
 * NE PAS confondre avec le bras D nominal (priors minés production).
 * Contamination latérale : agrège les hypothèses des fichiers de cas (vraie cause incluse).
 * Manifeste : priors_source = "pilot_cases"
 *
 * Usage:
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... pnpm seed:pilot-signatures
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';

import {
  finalizeSignaturePriors,
  signatureHasRealCause,
  type DiagPriorRow,
} from '../../AskMarcel-WebApp-NextJS/lib/diagnostic-v2/canonical-hypotheses';
import { buildSignature } from '../lib/signature.js';

const WINDOW_START = '2026-03-30';
const WINDOW_END = '2026-07-26';

type PilotCase = {
  id: string;
  context: { equipment_type: string };
  symptom: { code_present: string | null };
  hypotheses: Array<{ id: string; prior: number; n_observations?: number }>;
};

function aggregateFromCases(cases: PilotCase[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const c of cases) {
    for (const h of c.hypotheses) {
      const n = h.n_observations ?? 0;
      if (n <= 0) continue;
      counts.set(h.id, (counts.get(h.id) ?? 0) + n);
    }
  }
  return counts;
}

async function loadParentCounts(
  supabase: ReturnType<typeof createClient>,
  equipmentType: string,
): Promise<Map<string, number>> {
  const parentSig = buildSignature(equipmentType, null);
  const { data } = await supabase
    .from('diag_priors')
    .select('hypothesis_id, n_observations')
    .eq('signature', parentSig);
  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    counts.set(row.hypothesis_id, row.n_observations);
  }
  return counts;
}

async function existingSignatures(
  supabase: ReturnType<typeof createClient>,
): Promise<Set<string>> {
  const { data } = await supabase.from('diag_priors').select('signature');
  return new Set((data ?? []).map((r) => r.signature as string));
}

function mergeCounts(a: Map<string, number>, b: Map<string, number>, weightB = 0.35): Map<string, number> {
  const out = new Map(a);
  for (const [hid, n] of b) {
    const blended = Math.round((out.get(hid) ?? 0) * (1 - weightB) + n * weightB);
    out.set(hid, blended);
  }
  return out;
}

function toRows(
  sig: string,
  counts: Map<string, number>,
  parentCounts?: Map<string, number>,
): DiagPriorRow[] {
  return finalizeSignaturePriors(counts, {
    signature: sig,
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    mappingMethod: 'manual',
    mappingConfidence: 0.75,
    parentCounts,
  });
}

/** Comptes domaine 7H — débit insuffisant PAC air-eau (corpus + pilote). */
const SEED_7H_COUNTS = new Map<string, number>([
  ['air_circuit', 52],
  ['pompe_grippee', 41],
  ['pression_basse', 36],
  ['filtre_colmate', 28],
  ['defaut_debit', 24],
  ['flowswitch_hs', 18],
  ['bypass_ferme', 14],
  ['vanne_fermee', 9],
  ['sous_dimension', 8],
  ['carte_hs', 6],
]);

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

  const bySig = new Map<string, PilotCase[]>();
  for (const c of cases) {
    const sig = buildSignature(c.context.equipment_type, c.symptom.code_present);
    const arr = bySig.get(sig) ?? [];
    arr.push(c);
    bySig.set(sig, arr);
  }

  const existing = await existingSignatures(supabase);
  const toUpsert: DiagPriorRow[] = [];
  const report: Array<{ signature: string; key: string; action: string; rows: number }> = [];

  for (const [sig, group] of bySig) {
    const key = `${group[0]!.context.equipment_type}|${group[0]!.symptom.code_present ?? ''}`;
    const { count } = await supabase
      .from('diag_priors')
      .select('*', { count: 'exact', head: true })
      .eq('signature', sig);
    const hasEnough = (count ?? 0) >= 3;

    if (hasEnough && existing.has(sig)) {
      report.push({ signature: sig, key, action: 'skip_ok', rows: count ?? 0 });
      continue;
    }

    let counts = aggregateFromCases(group);
    const equipmentType = group[0]!.context.equipment_type;
    let parentCounts: Map<string, number> | undefined;

    if (key === 'pac_air_eau|7H') {
      counts = mergeCounts(SEED_7H_COUNTS, counts, 0.5);
    } else {
      parentCounts = await loadParentCounts(supabase, equipmentType);
      if (parentCounts.size > 0) {
        counts = mergeCounts(counts, parentCounts, 0.4);
      }
    }

    if (!signatureHasRealCause(counts)) {
      console.error(
        `[D*] ABORT: signature ${sig} (${key}) sans cause réelle — ne pas seeder du filler pilote`,
      );
      process.exit(1);
    }

    const rows = toRows(sig, counts, parentCounts);
    if (!rows.length) {
      report.push({ signature: sig, key, action: 'skip_empty', rows: 0 });
      continue;
    }

    toUpsert.push(...rows);
    report.push({ signature: sig, key, action: hasEnough ? 'supplement' : 'seed', rows: rows.length });
  }

  for (let i = 0; i < toUpsert.length; i += 200) {
    const chunk = toUpsert.slice(i, i + 200);
    const { error } = await supabase.from('diag_priors').upsert(chunk, {
      onConflict: 'signature,hypothesis_id',
    });
    if (error) throw error;
  }

  const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '../reports');
  const runsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../runs');
  mkdirSync(outDir, { recursive: true });
  mkdirSync(runsDir, { recursive: true });

  const manifest = {
    arm: 'D_star',
    priors_source: 'pilot_cases',
    assisted_priors: true,
    seeded_at: new Date().toISOString(),
    total_rows: toUpsert.length,
    note: 'Bras D* — priors assistés par fichiers cas pilote. Non comparable au bras D nominal sans annotation.',
    signatures: report,
  };

  const reportPath = resolve(outDir, `pilot-signature-seed-${new Date().toISOString().slice(0, 10)}.json`);
  writeFileSync(reportPath, JSON.stringify(manifest, null, 2) + '\n');
  writeFileSync(resolve(runsDir, 'manifest-d-star.json'), JSON.stringify(manifest, null, 2) + '\n');

  console.log(`[D*] Seeded ${toUpsert.length} prior rows (priors_source=pilot_cases)`);
  for (const r of report) {
    console.log(`  ${r.signature} (${r.key}): ${r.action} → ${r.rows} rows`);
  }
  console.log(`Report: ${reportPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
