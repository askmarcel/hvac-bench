/**
 * Recascade pilote post re-minage : O_bayes → O_bayes_db → D → seed → D*.
 *
 * Usage:
 *   pnpm run:pilot-cascade
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const benchRoot = resolve(import.meta.dirname, '..');

function run(cmd: string, env?: Record<string, string>) {
  console.log(`\n>>> ${cmd}`);
  execSync(cmd, {
    cwd: benchRoot,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
}

function latestRunDir(prefix: string): string {
  const runsDir = resolve(benchRoot, 'runs');
  const dirs = readdirSync(runsDir)
    .filter((d) => d.startsWith(prefix))
    .map((d) => ({ d, m: statSync(resolve(runsDir, d)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  if (!dirs[0]) throw new Error(`No run dir for ${prefix}`);
  return resolve(runsDir, dirs[0].d);
}

function readScore(runDir: string, scoreFile: string) {
  const p = resolve(runDir, scoreFile);
  return JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
}

function readRawJsonl(runDir: string): Array<Record<string, unknown>> {
  const p = resolve(runDir, 'raw.jsonl');
  return readFileSync(p, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

function quotaVoidCount(runDir: string): number {
  return readRawJsonl(runDir).filter((r) => {
    const out = r.final_output as Record<string, unknown> | undefined;
    return out?.state === 'error' && String(out.error ?? '').includes('quota_exceeded');
  }).length;
}

async function main() {
  const webEnv = resolve(benchRoot, '../AskMarcel-WebApp-NextJS/.env');
  const benchEnv = resolve(benchRoot, '.env.bench');
  let supabaseEnv: Record<string, string> = {};
  let benchApiEnv: Record<string, string> = {};

  for (const line of readFileSync(webEnv, 'utf8').split('\n')) {
    const m = line.match(/^(NEXT_PUBLIC_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)=(.+)$/);
    if (m) supabaseEnv[m[1]!] = m[2]!;
  }
  for (const line of readFileSync(benchEnv, 'utf8').split('\n')) {
    const m = line.match(/^(BENCH_API_URL|BENCH_API_KEY)=(.+)$/);
    if (m) benchApiEnv[m[1]!] = m[2]!;
  }

  run('pnpm run:v2:arm-o-bayes');
  const oBayesDir = latestRunDir('o-bayes');

  run('pnpm run:v2:arm-o-bayes-db', supabaseEnv);
  const oBayesDbDir = latestRunDir('o-bayes-db');

  run('pnpm run:v2:arm-d -- --cases dataset/pilot/pilot-v2.jsonl --replicates 1', benchApiEnv);
  const dDir = latestRunDir('pilot-v2-d');

  run('pnpm seed:pilot-signatures', supabaseEnv);
  run(
    'pnpm run:v2:arm-d -- --arm D_star --cases dataset/pilot/pilot-v2.jsonl --replicates 1',
    benchApiEnv,
  );
  const dStarDir = latestRunDir('pilot-v2-d_star');

  const dStarScore = readScore(dStarDir, 'score-d.json');
  const dStarVoid = quotaVoidCount(dStarDir);
  const dStarEntry =
    dStarVoid > 0
      ? {
          status: 'void' as const,
          void_reason: `quota_exceeded sur ${dStarVoid} cas — run invalide`,
          run_dir: dStarDir,
        }
      : { status: 'ok' as const, run_dir: dStarDir, ...dStarScore };

  const summary = {
    cascaded_at: new Date().toISOString(),
    O_bayes: { run_dir: oBayesDir, ...readScore(oBayesDir, 'score-o-bayes.json') },
    O_bayes_db: { run_dir: oBayesDbDir, ...readScore(oBayesDbDir, 'score-o-bayes-db.json') },
    D: { run_dir: dDir, ...readScore(dDir, 'score-d.json') },
    D_star: dStarEntry,
    deltas: {} as Record<string, number | null>,
  };

  const pick = (m: Record<string, unknown>, k: string) =>
    typeof m[k] === 'number' ? (m[k] as number) : null;

  summary.deltas = {
    'O_bayes_minus_O_bayes_db_conv5':
      pick(summary.O_bayes, 'convergence_at_5') != null && pick(summary.O_bayes_db, 'convergence_at_5') != null
        ? (pick(summary.O_bayes, 'convergence_at_5')! - pick(summary.O_bayes_db, 'convergence_at_5')!)
        : null,
    'O_bayes_db_minus_D_conv5':
      pick(summary.O_bayes_db, 'convergence_at_5') != null && pick(summary.D, 'convergence_at_5') != null
        ? (pick(summary.O_bayes_db, 'convergence_at_5')! - pick(summary.D, 'convergence_at_5')!)
        : null,
    'D_star_minus_D_expert_first_hit':
      dStarEntry.status === 'ok' &&
      pick(summary.D_star as Record<string, unknown>, 'expert_path_first_hit_rate') != null &&
      pick(summary.D, 'expert_path_first_hit_rate') != null
        ? (pick(summary.D_star as Record<string, unknown>, 'expert_path_first_hit_rate')! -
            pick(summary.D, 'expert_path_first_hit_rate')!)
        : null,
  };

  const outDir = resolve(benchRoot, 'reports');
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, `pilot-cascade-${new Date().toISOString().slice(0, 10)}.json`);
  writeFileSync(outPath, JSON.stringify(summary, null, 2) + '\n');

  console.log('\n=== CASCADE SUMMARY ===');
  for (const arm of ['O_bayes', 'O_bayes_db', 'D', 'D_star'] as const) {
    const m = summary[arm] as Record<string, unknown>;
    if (m.status === 'void') {
      console.log(`${arm}: VOID — ${m.void_reason}`);
      continue;
    }
    console.log(
      `${arm}: conv@5=${m.convergence_at_5} expert_first_hit=${m.expert_path_first_hit_rate} path_cost_med=${m.path_cost_ratio_median}`,
    );
  }
  console.log('Deltas:', summary.deltas);
  console.log(`Rapport: ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
