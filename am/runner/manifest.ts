import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { HARNESS_MODEL_CONFIG, resolveHarnessModelId } from './harness-model-config.js';

const AM_ROOT = resolve(import.meta.dirname, '..');
const HVAC_BENCH_ROOT = resolve(AM_ROOT, '..');

export type RunManifest = {
  run_id: string;
  arm: 'L0' | 'LW' | 'PROD';
  split: 'dev' | 'gate';
  replicates: number;
  surface?: 'CORE' | 'S1' | 'S2' | 'S3';
  started_at: string;
  /** HEAD, suffixé `-dirty` si l'arbre WebApp n'est pas propre. */
  webapp_git_sha: string | null;
  /** Hash (16 hex) de `git status --porcelain` + `git diff HEAD` — null si arbre propre. */
  webapp_worktree_fingerprint: string | null;
  preregistration_hash: string | null;
  dataset_version: string;
  n_cases: number;
  harness_model_id: string;
  api_identifier: string;
  fallback_identifiers: string[];
  temperature: number | null;
  max_output_tokens: number;
  step_budget: number;
  t_max: number;
  allow_fallbacks: boolean;
  /** Fournisseur upstream OpenRouter épinglé (bench), ex. `DeepSeek`. */
  openrouter_provider_only: string | null;
  /** Bench : route uniquement vers les upstreams supportant tous les paramètres (tools). */
  openrouter_require_parameters: boolean;
};

export type WebappGitProvenance = {
  sha: string | null;
  dirty: boolean;
  worktree_fingerprint: string | null;
};

function resolveWebappPath(): string {
  return process.env.WEBAPP_REPO_PATH
    ? resolve(process.env.WEBAPP_REPO_PATH)
    : resolve(HVAC_BENCH_ROOT, '../AskMarcel-WebApp-NextJS');
}

/**
 * Provenance git WebApp — HEAD + empreinte worktree si sale (leçon O6/O10).
 * Un SHA nu sur arbre dirty ment : on suffixe `-dirty` et on joint l'empreinte.
 */
export function resolveWebappGitProvenance(): WebappGitProvenance {
  const webappPath = resolveWebappPath();
  if (!existsSync(resolve(webappPath, '.git'))) {
    return { sha: null, dirty: false, worktree_fingerprint: null };
  }
  try {
    const head = execSync('git rev-parse HEAD', { cwd: webappPath, encoding: 'utf8' }).trim();
    const porcelain = execSync('git status --porcelain', { cwd: webappPath, encoding: 'utf8' }).trim();
    const diff = execSync('git diff HEAD', { cwd: webappPath, encoding: 'utf8' }).trim();
    const dirty = porcelain.length > 0 || diff.length > 0;
    if (!dirty) {
      return { sha: head, dirty: false, worktree_fingerprint: null };
    }
    const fingerprint = createHash('sha256')
      .update(porcelain)
      .update('\n---\n')
      .update(diff)
      .digest('hex')
      .slice(0, 16);
    return { sha: `${head}-dirty`, dirty: true, worktree_fingerprint: fingerprint };
  } catch {
    return { sha: null, dirty: false, worktree_fingerprint: null };
  }
}

/** @deprecated Préférer resolveWebappGitProvenance() */
export function resolveWebappGitSha(): string | null {
  return resolveWebappGitProvenance().sha;
}

/** Gate interdit sur arbre WebApp sale — le SHA seul ne trace pas le code exécuté. */
export function assertWebappGitCleanForGate(split: 'dev' | 'gate'): void {
  if (split !== 'gate') return;
  const prov = resolveWebappGitProvenance();
  if (prov.dirty) {
    throw new Error(
      `Arbre WebApp sale (gate interdit). webapp_git_sha=${prov.sha} worktree=${prov.worktree_fingerprint}. ` +
        `Commitez ou stashiez avant am:run-gate.`,
    );
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
  surface?: 'CORE' | 'S1' | 'S2' | 'S3';
}): RunManifest {
  const cases = loadCasesForSplit(args.split);
  const git = resolveWebappGitProvenance();
  return {
    run_id: args.runId,
    arm: args.arm,
    split: args.split,
    replicates: args.replicates,
    surface: args.surface,
    started_at: new Date().toISOString(),
    webapp_git_sha: git.sha,
    webapp_worktree_fingerprint: git.worktree_fingerprint,
    preregistration_hash: resolvePreregistrationHash(),
    dataset_version: datasetVersion(cases),
    n_cases: cases.length,
    harness_model_id: resolveHarnessModelId(),
    api_identifier: HARNESS_MODEL_CONFIG.api_identifier,
    fallback_identifiers: [...HARNESS_MODEL_CONFIG.fallback_identifiers],
    temperature: HARNESS_MODEL_CONFIG.temperature,
    max_output_tokens: HARNESS_MODEL_CONFIG.max_output_tokens,
    step_budget: HARNESS_MODEL_CONFIG.step_budget,
    t_max: HARNESS_MODEL_CONFIG.t_max,
    allow_fallbacks: HARNESS_MODEL_CONFIG.allow_fallbacks,
    openrouter_provider_only:
      process.env.AM_HARNESS_OPENROUTER_PROVIDER_ONLY?.trim() || 'AtlasCloud',
    openrouter_require_parameters: true,
  };
}
