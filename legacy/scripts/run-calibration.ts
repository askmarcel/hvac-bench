/**
 * Orchestration calibration — gate bloquant Phase 1
 *
 * Usage: pnpm run:v2:calibrate [--cases dataset/pilot/pilot-v2.jsonl]
 */
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadPreregistrationHash } from '../runners/preregistration.js';
import { validateExpertPaths } from './validate-expert-paths.js';

const ROOT = resolve(import.meta.dirname, '..');

function run(cmd: string) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { cwd: ROOT, stdio: 'inherit', env: process.env });
}

function main() {
  const expert = validateExpertPaths({
    allowPending: process.env.BENCH_ALLOW_PENDING_EXPERT_PATHS === '1',
  });
  if (!expert.ok) {
    console.error('Calibration bloquée : expert_path non approuvés.');
    console.error('Définir review_status=approved ou BENCH_ALLOW_PENDING_EXPERT_PATHS=1 (dev).');
    process.exit(1);
  }

  const calDir = resolve(ROOT, `runs/calibration-${new Date().toISOString().slice(0, 10)}`);
  mkdirSync(calDir, { recursive: true });

  run('pnpm run:v2:arm-o-plumbing');
  const plumbingRuns = execSync('ls -td runs/cal-o_plumbing-* 2>/dev/null | head -1', {
    cwd: ROOT,
    encoding: 'utf8',
  }).trim();
  const plumbingScore = JSON.parse(
    readFileSync(resolve(ROOT, plumbingRuns, 'score-o-plumbing.json'), 'utf8'),
  ) as { convergence_at_5: number };

  if (plumbingScore.convergence_at_5 < 1) {
    writeFileSync(
      resolve(calDir, 'calibration.json'),
      JSON.stringify({ status: 'red', reason: 'O_plumbing < 100%', o_plumbing: plumbingScore }, null, 2),
    );
    process.exit(1);
  }

  let oCeiling: Record<string, unknown> | null = null;
  if (process.env.OPENROUTER_API_KEY) {
    try {
      run('pnpm run:v2:arm-o-ceiling');
      const ceilingRun = execSync('ls -td runs/cal-o_ceiling-* 2>/dev/null | head -1', {
        cwd: ROOT,
        encoding: 'utf8',
      }).trim();
      oCeiling = JSON.parse(readFileSync(resolve(ROOT, ceilingRun, 'score-o-ceiling.json'), 'utf8'));
    } catch {
      console.warn('O_plafond non exécuté (OPENROUTER ou erreur).');
    }
  } else {
    console.warn('OPENROUTER_API_KEY absent — O_plafond ignoré.');
  }

  run('pnpm run:v2:arm-r');
  const rRun = execSync('ls -td runs/cal-r-* 2>/dev/null | head -1', {
    cwd: ROOT,
    encoding: 'utf8',
  }).trim();
  const rScore = JSON.parse(readFileSync(resolve(ROOT, rRun, 'score-r.json'), 'utf8'));

  const calibration = {
    status: 'green',
    o_plumbing: plumbingScore,
    o_ceiling: oCeiling,
    r_baseline: rScore,
    plumbing_run: plumbingRuns,
    r_run: rRun,
    preregistration_hash: loadPreregistrationHash(),
    created_at: new Date().toISOString(),
  };
  writeFileSync(resolve(calDir, 'calibration.json'), JSON.stringify(calibration, null, 2) + '\n');
  console.log('\nCalibration VERTE :', calDir);
}

main();
