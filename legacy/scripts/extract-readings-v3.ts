#!/usr/bin/env tsx
/**
 * Extrait readings quantitatifs des cas pilote v2 (PAC uniquement).
 */
import { readFileSync, writeFileSync } from 'node:fs';

import { parseObservationText } from '../lib/v3/readings-parser.js';
import { PATHS } from '../lib/v3/paths.js';

type V2Case = {
  id: string;
  context: { equipment_type?: string };
  tests: Array<{ action_id: string; observation: string }>;
};

function main() {
  const lines = readFileSync(PATHS.pilotV2, 'utf8').split('\n').filter(Boolean);
  const cases = lines.map((l) => JSON.parse(l) as V2Case);
  const pac = cases.filter((c) => c.context?.equipment_type === 'pac_air_eau');

  const results: Array<{
    case_id: string;
    action_id: string;
    observation: string;
    status: string;
    readings: unknown[];
  }> = [];

  const marcelRows = ['case_id,action_id,observation_text,value_to_enter,reviewer'];

  for (const c of pac) {
    for (const t of c.tests) {
      const parsed = parseObservationText(t.observation, t.action_id);
      results.push({
        case_id: c.id,
        action_id: t.action_id,
        observation: t.observation,
        status: parsed.status,
        readings: parsed.readings,
      });
      if (parsed.status === 'unparseable') {
        marcelRows.push(
          `${c.id},${t.action_id},"${t.observation.replace(/"/g, '""')}",,marcel`,
        );
      }
    }
  }

  const parsedCount = results.filter((r) => r.status === 'parsed').length;
  const mappedCount = results.filter((r) => r.status === 'qualitative_mapped').length;
  const total = results.length;
  const pct = total > 0 ? (parsedCount + mappedCount) / total : 0;

  const report = {
    generated_at: new Date().toISOString(),
    scope: 'pac_air_eau pilot',
    total_tests: total,
    parsed: parsedCount,
    qualitative_mapped: mappedCount,
    unparseable: results.filter((r) => r.status === 'unparseable').length,
    pct_parsed_or_mapped: Math.round(pct * 1000) / 1000,
    target_pct: 0.7,
    pass: pct >= 0.7,
    results,
  };

  writeFileSync(PATHS.readingsExtraction, JSON.stringify(report, null, 2));
  writeFileSync(PATHS.marcelParserReview, `${marcelRows.join('\n')}\n`);
  console.log(JSON.stringify({ total, pct, pass: report.pass }, null, 2));
  if (!report.pass) process.exit(1);
}

main();
