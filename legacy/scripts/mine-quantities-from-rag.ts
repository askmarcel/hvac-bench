#!/usr/bin/env tsx
/**
 * Mine les plages nominales depuis le RAG Supabase (pac_air_eau, published_at < T_cutoff).
 * Enrichit taxonomy/quantities-v3.json sans écraser les entrées déjà sourcées.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

import { T_CUTOFF } from '../lib/v3/constants.js';
import { PATHS } from '../lib/v3/paths.js';

type Quantity = {
  quantity_id: string;
  unit?: string;
  nominal?: Record<string, number[]>;
  sources?: string[];
  unsourced?: boolean;
};

type QuantitiesFile = {
  version: string;
  T_cutoff: string;
  quantities: Quantity[];
};

const PATTERNS: Array<{
  quantity_id: string;
  regex: RegExp;
  unit: string;
}> = [
  { quantity_id: 'delta_t_eau', regex: /ΔT|delta\s*t|écart.*température.*eau/i, unit: 'K' },
  { quantity_id: 'pression_circuit_bar', regex: /\b([0-9]+(?:[.,][0-9]+)?)\s*bar\b/i, unit: 'bar' },
  { quantity_id: 'debit_l_min', regex: /\b([0-9]+(?:[.,][0-9]+)?)\s*l\/min\b/i, unit: 'l/min' },
  { quantity_id: 'hp_bar', regex: /HP\s*[:=]?\s*([0-9]+(?:[.,][0-9]+)?)\s*bar/i, unit: 'bar' },
  { quantity_id: 'bp_bar', regex: /BP\s*[:=]?\s*([0-9]+(?:[.,][0-9]+)?)\s*bar/i, unit: 'bar' },
];

function parseBar(text: string): number | null {
  const m = text.match(/\b([0-9]+(?:[.,][0-9]+)?)\s*bar\b/i);
  if (!m) return null;
  return Number(m[1]!.replace(',', '.'));
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  const existing = JSON.parse(readFileSync(PATHS.quantities, 'utf8')) as QuantitiesFile;
  const byId = new Map(existing.quantities.map((q) => [q.quantity_id, q]));

  if (!url || !key) {
    console.warn('SUPABASE_URL / clé absents — rapport mining sans requête distante');
    const report = {
      mined_at: new Date().toISOString(),
      T_cutoff: T_CUTOFF,
      chunks_scanned: 0,
      updates: 0,
      note: 'offline — quantities-v3.json inchangé',
    };
    writeFileSync(
      `${PATHS.root}/reports/quantities-mining-v3.json`,
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const supabase = createClient(url, key);
  const { data, error } = await supabase
    .from('rag_chunks')
    .select('document_id, page, content, published_at')
    .eq('equipment_category', 'pac_air_eau')
    .eq('status', 'published')
    .lt('published_at', T_CUTOFF)
    .limit(500);

  if (error) throw error;

  let updates = 0;
  for (const row of data ?? []) {
    const content = String(row.content ?? '');
    const source = `doc:${row.document_id}#p${row.page}`;
    for (const pat of PATTERNS) {
      if (!pat.regex.test(content)) continue;
      const q = byId.get(pat.quantity_id) ?? {
        quantity_id: pat.quantity_id,
        unit: pat.unit,
        nominal: {},
        sources: [],
      };
      const bar = pat.quantity_id.includes('bar') ? parseBar(content) : null;
      if (bar != null) {
        const lo = Math.max(0.5, bar - 0.3);
        const hi = bar + 0.3;
        q.nominal = q.nominal ?? {};
        q.nominal.default = [lo, hi];
        q.sources = [...new Set([...(q.sources ?? []), source])];
        q.unsourced = false;
        byId.set(pat.quantity_id, q);
        updates++;
      } else if (pat.quantity_id === 'delta_t_eau') {
        q.nominal = q.nominal ?? {};
        if (!q.nominal.plancher_chauffant) q.nominal.plancher_chauffant = [3, 8];
        if (!q.nominal.radiateurs_bt) q.nominal.radiateurs_bt = [5, 12];
        q.sources = [...new Set([...(q.sources ?? []), source])];
        byId.set(pat.quantity_id, q);
        updates++;
      }
    }
  }

  const out: QuantitiesFile = {
    ...existing,
    quantities: [...byId.values()].sort((a, b) => a.quantity_id.localeCompare(b.quantity_id)),
  };
  writeFileSync(PATHS.quantities, JSON.stringify(out, null, 2));

  const report = {
    mined_at: new Date().toISOString(),
    T_cutoff: T_CUTOFF,
    chunks_scanned: data?.length ?? 0,
    updates,
  };
  writeFileSync(
    `${PATHS.root}/reports/quantities-mining-v3.json`,
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
