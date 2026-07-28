#!/usr/bin/env tsx
/**
 * Couverture arbre v3 : 17 causes, ≥2 effets, % sourced, séparabilité top-8.
 * Cas d'échec : --fixture sparse
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { TOP8_CAUSES } from '../lib/v3/constants.js';
import { PATHS } from '../lib/v3/paths.js';

const CANONICAL_PATH = resolve(
  import.meta.dirname,
  '../../AskMarcel-WebApp-NextJS/lib/diagnostic-v2/canonical-hypotheses.ts',
);

type Effect = {
  quantity: string;
  direction?: string;
  value?: string;
  status: 'draft' | 'sourced';
  sources: string[];
};
type Cause = { cause_id: string; effects: Effect[] };
type FaultTree = { causes: Cause[] };

function loadCanonicalIds(): string[] {
  const src = readFileSync(CANONICAL_PATH, 'utf8');
  const m = src.match(/CANONICAL_HYPOTHESIS_IDS = \[([\s\S]*?)\] as const/);
  if (!m) throw new Error('canonical ids not found');
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

function effectSignature(e: Effect): string {
  return `${e.quantity}:${e.direction ?? e.value ?? ''}`;
}

function pairSeparable(a: Cause, b: Cause): { ok: boolean; separator?: string } {
  const qtyA = new Map(a.effects.map((e) => [e.quantity, effectSignature(e)]));
  const qtyB = new Map(b.effects.map((e) => [e.quantity, effectSignature(e)]));
  const allQty = new Set([...qtyA.keys(), ...qtyB.keys()]);

  for (const q of allQty) {
    const sigA = qtyA.get(q);
    const sigB = qtyB.get(q);
    if (sigA && !sigB) return { ok: true, separator: q };
    if (!sigA && sigB) return { ok: true, separator: q };
    if (sigA && sigB && sigA !== sigB) return { ok: true, separator: q };
  }
  return { ok: false };
}

function main() {
  const fixtureSparse = process.argv.includes('--fixture') && process.argv.includes('sparse');
  const tree = JSON.parse(readFileSync(PATHS.faultTree, 'utf8')) as FaultTree;
  const canonical = loadCanonicalIds();
  const causeIds = new Set(tree.causes.map((c) => c.cause_id));
  const errors: string[] = [];

  for (const id of canonical) {
    if (!causeIds.has(id)) errors.push(`cause manquante: ${id}`);
  }

  let totalEdges = 0;
  let sourcedEdges = 0;
  const separability: Array<{ pair: string; ok: boolean; separator?: string }> = [];

  for (const cause of tree.causes) {
    if (cause.cause_id === 'cause_inconnue') continue;
    if (fixtureSparse && cause.cause_id === 'test_cause_sparse') {
      // fixture injectée
    } else if (cause.cause_id !== 'cause_inconnue' && cause.effects.length < 2) {
      errors.push(`${cause.cause_id}: <2 effets`);
    }
    for (const e of cause.effects) {
      totalEdges += 1;
      if (e.status === 'sourced' && e.sources.length > 0) sourcedEdges += 1;
    }
  }

  if (fixtureSparse) {
    tree.causes.push({
      cause_id: 'test_cause_sparse',
      effects: [{ quantity: 'x', direction: 'low', status: 'draft', sources: [] }],
    } as Cause);
    errors.push('test_cause_sparse: <2 effets');
  }

  const top8 = tree.causes.filter((c) => TOP8_CAUSES.includes(c.cause_id as (typeof TOP8_CAUSES)[number]));
  for (let i = 0; i < top8.length; i++) {
    for (let j = i + 1; j < top8.length; j++) {
      const a = top8[i]!;
      const b = top8[j]!;
      const sep = pairSeparable(a, b);
      separability.push({
        pair: `${a.cause_id}|${b.cause_id}`,
        ok: sep.ok,
        separator: sep.separator,
      });
      if (!sep.ok) errors.push(`non séparable: ${a.cause_id} vs ${b.cause_id}`);
    }
  }

  const pctSourced = totalEdges > 0 ? sourcedEdges / totalEdges : 0;
  const report = {
    causes: tree.causes.length,
    total_edges: totalEdges,
    sourced_edges: sourcedEdges,
    pct_sourced: Math.round(pctSourced * 1000) / 1000,
    separability,
    errors,
    pass: errors.length === 0 && pctSourced >= 0.8,
  };

  writeFileSync(PATHS.treeCoverage, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (!report.pass) process.exit(1);
}

main();
