/**
 * Pilote live complet — calibration + D/B/E + intégrité + compare
 *
 * Usage: BENCH_ALLOW_PENDING_EXPERT_PATHS=1 pnpm run:v2:pilot-live
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

function run(cmd: string) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { cwd: ROOT, stdio: 'inherit', env: process.env });
}

function latestRun(prefix: string): string {
  return execSync(`ls -td runs/${prefix}-* 2>/dev/null | head -1`, {
    cwd: ROOT,
    encoding: 'utf8',
  }).trim();
}

function main() {
  const out = `runs/pilot-v2-live-${new Date().toISOString().slice(0, 10)}`;

  run('pnpm run:v2:calibrate');

  const calDir = execSync('ls -td runs/calibration-* 2>/dev/null | head -1', {
    cwd: ROOT,
    encoding: 'utf8',
  }).trim();

  run('pnpm run:v2:arm-d');
  const dDir = latestRun('pilot-v2-d');

  if (process.env.OPENROUTER_API_KEY) {
    run('pnpm run:v2:arm-b');
    run('pnpm run:v2:arm-e');
  } else {
    console.warn('OPENROUTER_API_KEY absent — B/E ignorés.');
  }

  const bDir = latestRun('pilot-v2-b');
  const eDir = latestRun('pilot-v2-e');
  const rDir = latestRun('cal-r');

  run(
    `pnpm merge:arm-runs -- --out ${out} --d ${dDir} --b ${bDir} --e ${eDir} --calibration ${calDir} --r ${rDir}`,
  );
  run(`pnpm check-run-integrity -- --run-dir ${out} --arm D`);
  run(`pnpm run:v2:compare -- --run-dir ${out}`);

  const report = readFileSync(resolve(ROOT, 'reports/pilot-v2-D-vs-B-vs-E.md'), 'utf8');
  console.log('\n--- Rapport ---\n', report.slice(0, 800));
}

main();
