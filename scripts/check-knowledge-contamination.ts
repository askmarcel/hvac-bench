#!/usr/bin/env tsx
/**
 * Anti-contamination connaissance v3 (5 règles).
 * Cas d'échec : --fixture leak
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { T_CUTOFF } from '../lib/v3/constants.js';
import { PATHS } from '../lib/v3/paths.js';

const REPORT_PATH = resolve(import.meta.dirname, '../reports/knowledge-sources-manifest.json');

type Quantity = {
  quantity_id: string;
  nominal?: Record<string, number[]>;
  sources?: string[];
};
type QuantitiesFile = { quantities: Quantity[] };
type KnowledgeManifest = {
  knowledge_sources: string[];
  allowed_dev_source_domains: string[];
};
type DevCase = {
  id: string;
  harvest?: { source_url?: string; neon_id?: string };
};

function collectSources(obj: unknown, out: string[] = []): string[] {
  if (Array.isArray(obj)) {
    for (const v of obj) collectSources(v, out);
    return out;
  }
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'sources' && Array.isArray(v)) {
        for (const s of v) if (typeof s === 'string') out.push(s);
      } else {
        collectSources(v, out);
      }
    }
  }
  return out;
}

function hostFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function main() {
  const fixtureLeak = process.argv.includes('--fixture') && process.argv.includes('leak');
  const quantities = JSON.parse(readFileSync(PATHS.quantities, 'utf8')) as QuantitiesFile;
  const faultTree = JSON.parse(readFileSync(PATHS.faultTree, 'utf8'));
  const manifest = JSON.parse(readFileSync(PATHS.knowledgeManifest, 'utf8')) as KnowledgeManifest;
  const errors: string[] = [];

  const allSources = [
    ...collectSources(quantities),
    ...collectSources(faultTree),
  ];
  if (fixtureLeak) allSources.push('hb2-0001');

  for (const src of allSources) {
    if (/hb2-\d{4}/.test(src)) errors.push(`case_id gate/pilote dans sources: ${src}`);
  }

  for (const q of quantities.quantities) {
    if (!q.nominal) continue;
    for (const ranges of Object.values(q.nominal)) {
      if (ranges.length === 2 && ranges[0] === ranges[1] && ranges[0] === 1.8) {
        errors.push(`singleton suspect ${q.quantity_id}: [1.8, 1.8]`);
      }
    }
  }

  let devCases: DevCase[] = [];
  if (existsSync(PATHS.historicalV3)) {
    const lines = readFileSync(PATHS.historicalV3, 'utf8').split('\n').filter(Boolean);
    devCases = lines.map((l) => JSON.parse(l) as DevCase);
  }

  const ragDocIds = new Set(
    manifest.knowledge_sources.filter((s) => s.startsWith('doc:')).map((s) => s.replace('doc:', '').split('#')[0]),
  );

  for (const c of devCases) {
    const url = c.harvest?.source_url;
    if (!url) continue;
    const host = hostFromUrl(url);
    if (
      host &&
      !manifest.allowed_dev_source_domains.some((d) => host === d || host.endsWith(`.${d}`))
    ) {
      errors.push(`${c.id}: domaine forum non autorisé ${host}`);
    }
    for (const docId of ragDocIds) {
      if (url.includes(docId)) errors.push(`${c.id}: intersection source forum / doc OEM ${docId}`);
    }
  }

  const report = {
    checked_at: new Date().toISOString(),
    T_cutoff: T_CUTOFF,
    knowledge_sources: manifest.knowledge_sources,
    sources_checked: allSources.length,
    dev_cases: devCases.length,
    errors,
    pass: errors.length === 0,
  };

  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (!report.pass) process.exit(1);
}

main();
