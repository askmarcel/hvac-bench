#!/usr/bin/env tsx
/**
 * Relance uniquement les réplicats `blocked` d'un ou plusieurs score.json,
 * fusionne dans le run d'origine (raw.jsonl) et re-score.
 *
 * Usage:
 *   pnpm am:retry-blocked --artifact-dir prior-report
 *   pnpm am:retry-blocked --score runs/am-lw-<ts>/score.json
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { execSync } from 'node:child_process';

const HVAC_BENCH_ROOT = resolve(import.meta.dirname, '../..');

type ScoreOutput = {
  run_id: string;
  arm: 'L0' | 'LW' | 'PROD';
  split: 'dev' | 'gate';
  replicates: Array<{
    case_id: string;
    replicate: number;
    status: string;
    blocked_reason?: string;
    transcript_text?: string;
  }>;
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function findScoreFiles(artifactDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = resolve(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name === 'score.json') out.push(p);
    }
  };
  walk(artifactDir);
  return out;
}

function run(cmd: string) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { cwd: HVAC_BENCH_ROOT, stdio: 'inherit', env: process.env });
}

type TranscriptTurn = { role: 'technicien' | 'installateur'; content: string };

function parseTranscriptText(text: string): TranscriptTurn[] {
  if (!text.trim()) return [];
  return text.split('\n\n').map((block) => {
    const match = block.match(/^(Installateur|Technicien):\s*([\s\S]*)$/);
    if (!match) throw new Error(`Bloc transcript illisible: ${block.slice(0, 80)}…`);
    return {
      role: match[1] === 'Technicien' ? 'technicien' : 'installateur',
      content: match[2],
    } as TranscriptTurn;
  });
}

function ensureRunArtifacts(scorePath: string, score: ScoreOutput) {
  const runDir = resolve(dirname(scorePath));
  mkdirSync(runDir, { recursive: true });

  const manifestPath = resolve(runDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    writeFileSync(
      manifestPath,
      JSON.stringify(
        {
          run_id: score.run_id,
          arm: score.arm,
          split: score.split,
          replicates: 3,
          surface: 'S2',
        },
        null,
        2,
      ),
    );
  }

  const rawPath = resolve(runDir, 'raw.jsonl');
  if (!existsSync(rawPath)) {
    const records = score.replicates.map((item) => ({
      case_id: item.case_id,
      replicate: item.replicate,
      turns: parseTranscriptText((item as { transcript_text?: string }).transcript_text ?? ''),
      status: item.status,
      blocked_reason: item.blocked_reason,
    }));
    writeFileSync(rawPath, records.map((rec) => JSON.stringify(rec)).join('\n') + '\n');
    console.log(`ℹ️  raw.jsonl reconstruit depuis score.json (${records.length} enregistrements)`);
  }
}

function main() {
  const artifactDir = arg('artifact-dir');
  const scoreArg = arg('score');
  let scorePaths: string[] = [];

  if (artifactDir) {
    const dir = resolve(artifactDir);
    if (!existsSync(dir)) throw new Error(`artifact-dir introuvable: ${dir}`);
    scorePaths = findScoreFiles(dir);
  } else if (scoreArg) {
    scorePaths = [resolve(scoreArg)];
  } else {
    console.error('Usage: pnpm am:retry-blocked --artifact-dir <dir> | --score <path>');
    process.exit(1);
  }

  if (scorePaths.length === 0) {
    console.error('Aucun score.json trouvé.');
    process.exit(1);
  }

  let retried = 0;
  const rescoredRuns = new Set<string>();

  for (const scorePath of scorePaths) {
    const score = JSON.parse(readFileSync(scorePath, 'utf8')) as ScoreOutput;
    const blocked = score.replicates.filter((r) => r.status === 'blocked');
    if (blocked.length === 0) {
      console.log(`✅ ${score.arm}: aucun réplicat bloqué dans ${scorePath}`);
      continue;
    }

    const runDir = resolve(dirname(scorePath));
    ensureRunArtifacts(scorePath, score);
    console.log(`\n=== ${score.arm} — ${blocked.length} réplicat(s) bloqué(s) — ${basename(runDir)} ===`);

    for (const item of blocked) {
      run(
        `pnpm exec tsx am/runner/run-arm.ts --arm ${score.arm} --split ${score.split} --cases ${item.case_id} --replicate ${item.replicate} --run-dir ${runDir}`,
      );
      retried++;
    }
    rescoredRuns.add(runDir);
  }

  for (const runDir of rescoredRuns) {
    run(`pnpm am:score --run ${runDir}`);
  }

  console.log(`\n✅ ${retried} réplicat(s) relancé(s), ${rescoredRuns.size} run(s) re-scoré(s).`);
  if (retried === 0) process.exit(0);
}

main();
