import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

export type RunManifest = {
  run_id: string;
  arm: 'L0' | 'LW' | 'PROD';
  split: 'dev' | 'gate';
  replicates: number;
  surface?: 'S1' | 'S2' | 'S3';
  started_at: string;
  webapp_git_sha: string | null;
  preregistration_hash: string | null;
  dataset_version: string;
  n_cases: number;
};

const AM_ROOT = resolve(import.meta.dirname, '..');
const HVAC_BENCH_ROOT = resolve(AM_ROOT, '..');

/**
 * SHA du commit WebApp effectivement mesuré (leçon O6 : ce qui est mesuré = ce qui tourne).
 * null si le repo WebApp n'est pas trouvé au chemin attendu — jamais un SHA inventé.
 */
export function resolveWebappGitSha(): string | null {
  const webappPath = process.env.WEBAPP_REPO_PATH
    ? resolve(process.env.WEBAPP_REPO_PATH)
    : resolve(HVAC_BENCH_ROOT, '../AskMarcel-WebApp-NextJS');
  if (!existsSync(resolve(webappPath, '.git'))) return null;
  try {
    return execSync('git rev-parse HEAD', { cwd: webappPath, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

/** null si preregistration-am.md n'existe pas encore (T9, pas fait) — jamais un hash inventé. */
export function resolvePreregistrationHash(): string | null {
  const path = resolve(AM_ROOT, 'preregistration-am.md');
  if (!existsSync(path)) return null;
  return createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16);
}

function collectJsonFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((e) => resolve(dir, e))
    .flatMap((p) => (statSync(p).isDirectory() ? collectJsonFiles(p) : p.endsWith('.json') ? [p] : []));
}

export function loadCasesForSplit(split: 'dev' | 'gate'): { path: string; content: string }[] {
  const dir = resolve(AM_ROOT, 'cases', split);
  return collectJsonFiles(dir)
    .sort()
    .map((path) => ({ path, content: readFileSync(path, 'utf8') }));
}

/** Charge un cas par ID, quel que soit son split (dev ou gate). */
export function loadCaseById<T = unknown>(caseId: string): T {
  for (const split of ['dev', 'gate'] as const) {
    const path = resolve(AM_ROOT, 'cases', split, `${caseId}.json`);
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, 'utf8')) as T;
    }
  }
  throw new Error(`Cas introuvable: ${caseId} (ni dans cases/dev ni cases/gate)`);
}

export function datasetVersion(cases: { content: string }[]): string {
  const hash = createHash('sha256');
  for (const c of cases) hash.update(c.content);
  return hash.digest('hex').slice(0, 16);
}

export function buildManifest(args: {
  runId: string;
  arm: RunManifest['arm'];
  split: RunManifest['split'];
  replicates: number;
  surface?: 'S1' | 'S2' | 'S3';
}): RunManifest {
  const cases = loadCasesForSplit(args.split);
  return {
    run_id: args.runId,
    arm: args.arm,
    split: args.split,
    replicates: args.replicates,
    surface: args.surface,
    started_at: new Date().toISOString(),
    webapp_git_sha: resolveWebappGitSha(),
    preregistration_hash: resolvePreregistrationHash(),
    dataset_version: datasetVersion(cases),
    n_cases: cases.length,
  };
}
