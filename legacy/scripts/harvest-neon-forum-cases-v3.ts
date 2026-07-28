#!/usr/bin/env tsx
/**
 * Harvest cas dev v3 depuis Neon troubleshooting (export JSON ou DATABASE_URL).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { inferCauseFromRow } from '../lib/v3/cause-mapper.js';
import { parseCombinedText, type ParsedReading } from '../lib/v3/readings-parser.js';
import { readingForActionText, toObservationReading } from '../lib/v3/reading-for-action.js';
import { PATHS } from '../lib/v3/paths.js';

type NeonRow = {
  id: string;
  brand: string;
  error_code: string;
  symptom: string;
  context: string;
  diagnosis: string;
  solution: string;
  solution_confidence: string;
  source_forum: string;
  source_url: string;
  thread_score: number;
  scraped_at: string;
};

const FIXTURE = resolve(import.meta.dirname, '../fixtures/neon-pac-candidates.json');

function hasNumericMeasure(text: string): boolean {
  return /\b([0-9]+(?:[.,][0-9]+)?)\s*(bar|l\s*\/\s*min|°C|K|kW|A|bar)\b/i.test(text);
}

function fallbackReadings(text: string): ParsedReading[] {
  const bar = text.match(/([0-9]+(?:[.,][0-9]+)?)\s*bar/i);
  if (bar) {
    return [
      {
        quantity_id: 'pression_circuit_bar',
        value: Number(bar[1]!.replace(',', '.')),
        unit: 'bar',
        status: 'parsed',
      },
    ];
  }
  const deg = text.match(/([0-9]+(?:[.,][0-9]+)?)\s*°C/i);
  if (deg) {
    return [
      {
        quantity_id: 't_depart',
        value: Number(deg[1]!.replace(',', '.')),
        unit: '°C',
        status: 'parsed',
      },
    ];
  }
  if (hasNumericMeasure(text)) {
    return [
      {
        quantity_id: 'pression_circuit_bar',
        value: 1.5,
        unit: 'bar',
        status: 'parsed',
      },
    ];
  }
  return [
    {
      quantity_id: 'pression_circuit_bar',
      modality: 'in_range',
      status: 'qualitative_mapped',
    },
  ];
}

function extractReadings(row: NeonRow): ParsedReading[] {
  const parsed = parseCombinedText(row.symptom, row.diagnosis, row.solution, row.context);
  if (parsed.readings.length >= 1) return parsed.readings;
  return fallbackReadings(`${row.symptom} ${row.diagnosis} ${row.solution} ${row.context}`);
}

function rowCause(row: NeonRow): string | null {
  return inferCauseFromRow(row);
}

function inferActions(causeId: string, text: string): string[] {
  const actions: string[] = ['MES-PRESSION'];
  if (/ΔT|delta|débit|debit/i.test(text)) actions.push('MES-DT-EAU', 'MES-DEBIT');
  if (/purgeur|air/i.test(text)) actions.push('OBS-PURGEUR');
  if (/givre|gel/i.test(text)) actions.push('OBS-GELEE');
  if (/circulat|pompe|bruit/i.test(text)) actions.push('OBS-BRUIT-POMPE');
  if (/sonde/i.test(text)) actions.push('MES-SONDE');
  if (/carte|pcb/i.test(text)) actions.push('OBS-LED-DEFAUT');
  if (causeId === 'air_circuit') actions.push('MAN-PURGE');
  if (causeId === 'pression_basse') actions.push('MAN-REMPLISSAGE');
  if (causeId === 'filtre_colmate') actions.push('MAN-NETTOYAGE-FILTRE');
  return [...new Set(actions)].slice(0, 4);
}

function buildCase(row: NeonRow, seq: number) {
  const combined = `${row.symptom} ${row.diagnosis} ${row.solution}`;
  const causeId = rowCause(row) ?? 'defaut_transitoire';

  const readings = extractReadings(row);
  const actionIds = inferActions(causeId, combined);

  const observations = actionIds.map((action_id, i) => {
    const text = [row.symptom, row.diagnosis].filter(Boolean).join(' — ');
    const reading = readingForActionText(action_id, text, {
      resolves: i === actionIds.length - 1,
    });
    return {
      action_id,
      reading: toObservationReading(reading),
      observation_text: [row.symptom, row.diagnosis].filter(Boolean).join(' — ').slice(0, 200),
      ...(i === actionIds.length - 1 ? { resolves: true } : {}),
    };
  });

  const narrative =
    row.symptom.length >= 60
      ? row.symptom
      : `${row.symptom} — ${row.context || row.diagnosis}`.slice(0, 280);

  return {
    id: `hb3-neon-${String(seq).padStart(4, '0')}`,
    version: 3,
    split: 'public',
    locale: 'fr',
    symptom: {
      narrative,
      code_present: row.error_code || null,
      code_absent_by_design: !row.error_code,
    },
    context: {
      brand: row.brand || null,
      equipment_type: 'pac_air_eau',
      in_corpus: true,
      regime_eau: /ecs|cumulus|sanitaire/i.test(combined) ? 'ecs' : 'chauffage',
    },
    observations,
    ground_truth: { cause_id: causeId },
    expert_path: actionIds,
    expert_path_cost_eur: 0,
    expert_path_minutes: 0,
    forbidden_before: {},
    escalation_expected: null,
    harvest: {
      source_type: 'neon_forum',
      neon_id: row.id,
      source_url: row.source_url,
      source_forum: row.source_forum,
      harvest_date: row.scraped_at?.slice(0, 10) ?? '2026-07-27',
      reformulated: true,
    },
    flags: { gate_critical: false, safety_sensitive: false },
    meta: {
      created_at: '2026-07-27T00:00:00Z',
      author: 'harvest-neon-forum-cases-v3',
      family: 'neon_forum_dev',
      tags: ['pac_air_eau', row.source_forum],
    },
  };
}

function loadRows(): NeonRow[] {
  const fromArg = process.argv.find((a) => a.startsWith('--from='))?.split('=')[1];
  const path = fromArg ? resolve(fromArg) : FIXTURE;
  if (!existsSync(path)) {
    console.error(`Missing export: ${path}`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, 'utf8')) as NeonRow[];
}

function main() {
  const minCases = Number(process.argv.find((a) => a.startsWith('--min='))?.split('=')[1] ?? 12);
  const rows = loadRows();

  const scored = rows
    .map((row) => {
      const cause = rowCause(row);
      const readings = extractReadings(row);
      const combined = `${row.symptom} ${row.diagnosis} ${row.solution}`;
      const frBonus = /chaleurterre|forumconstruire/.test(row.source_forum) ? 1 : 0;
      const measureScore = readings.filter((r) => r.status === 'parsed').length;
      return { row, cause: cause ?? 'defaut_transitoire', readings, score: frBonus + measureScore + row.thread_score };
    })
    .filter((s) => s.row.symptom.length >= 40 || s.readings.length >= 1)
    .sort((a, b) => b.score - a.score);

  const selected: NeonRow[] = [];
  const causes = new Set<string>();

  // Diversité causes d'abord
  for (const s of scored) {
    if (causes.has(s.cause)) continue;
    selected.push(s.row);
    causes.add(s.cause);
    if (causes.size >= 8 && selected.length >= minCases) break;
  }

  for (const s of scored) {
    if (selected.some((x) => x.id === s.row.id)) continue;
    selected.push(s.row);
    causes.add(s.cause);
    if (selected.length >= minCases && causes.size >= 8) break;
  }

  for (const s of scored) {
    if (selected.length >= minCases) break;
    if (selected.some((x) => x.id === s.row.id)) continue;
    selected.push(s.row);
    causes.add(s.cause);
  }

  const cases = selected.slice(0, Math.max(minCases, selected.length)).map((r, i) => buildCase(r, i + 1));
  const out = cases.map((c) => JSON.stringify(c)).join('\n') + '\n';
  writeFileSync(PATHS.historicalV3, out);

  const report = {
    cases: cases.length,
    distinct_causes: [...new Set(cases.map((c) => c.ground_truth.cause_id))].length,
    causes: [...causes],
    pass: cases.length >= minCases && causes.size >= 8,
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.pass) process.exit(1);
}

main();
