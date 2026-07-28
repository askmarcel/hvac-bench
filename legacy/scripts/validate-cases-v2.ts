import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

const schemaPath = resolve(import.meta.dirname, '../dataset/schema-v2.json');
const taxonomyPath = resolve(import.meta.dirname, '../taxonomy/actions-v2.json');
const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
const taxonomy = JSON.parse(readFileSync(taxonomyPath, 'utf8')) as {
  actions: Array<{ action_id: string }>;
};
const actionIds = new Set(taxonomy.actions.map((a) => a.action_id));
const validate = ajv.compile(schema);

type V2Case = {
  id: string;
  hypotheses: Array<{ id: string; prior: number; n_observations: number; true_cause: boolean }>;
  tests: Array<{ action_id: string; resolves?: boolean }>;
  expert_path: string[];
  forbidden_before?: Record<string, string[]>;
  escalation_expected?: unknown;
  flags: { sparse_priors: boolean };
  meta: { family: string };
  context: { in_corpus: boolean };
  symptom: { code_absent_by_design: boolean; code_present: string | null };
  harvest: { harvest_date: string; reformulated: boolean };
  split: string;
};

function collectJsonlFiles(target: string): string[] {
  const stat = statSync(target, { throwIfNoEntry: false });
  if (!stat) return [];
  if (stat.isFile() && target.endsWith('.jsonl')) return [target];
  if (!stat.isDirectory()) return [];
  return readdirSync(target).flatMap((e) => collectJsonlFiles(resolve(target, e)));
}

function validateSemantic(c: V2Case, file: string, line: number): string[] {
  const errors: string[] = [];
  const trueCauses = c.hypotheses.filter((h) => h.true_cause);
  if (trueCauses.length !== 1) errors.push('exactly one true_cause required');

  const priorSum = c.hypotheses.reduce((s, h) => s + h.prior, 0);
  if (priorSum < 0.95 || priorSum > 1.05) errors.push(`prior sum ${priorSum.toFixed(3)} not in [0.95,1.05]`);

  const testIds = new Set(c.tests.map((t) => t.action_id));
  for (const aid of c.expert_path) {
    if (!testIds.has(aid)) errors.push(`expert_path action ${aid} not in tests[]`);
    if (!actionIds.has(aid)) errors.push(`expert_path action ${aid} not in taxonomy`);
  }

  const lastPath = c.expert_path[c.expert_path.length - 1];
  const lastTest = c.tests.find((t) => t.action_id === lastPath);
  if (c.escalation_expected) {
    if (!lastPath?.startsWith('ESC-')) {
      errors.push('escalation case must end expert_path with ESC-*');
    }
    if (c.tests.some((t) => t.resolves)) {
      errors.push('escalation case must not have resolves:true in tests');
    }
  } else if (!lastTest?.resolves) {
    errors.push('last expert_path must have resolves:true unless escalation');
  }

  for (const t of c.tests) {
    if (!actionIds.has(t.action_id)) errors.push(`test ${t.action_id} not in taxonomy`);
  }

  const minObs = Math.min(...c.hypotheses.map((h) => h.n_observations));
  if (c.flags.sparse_priors !== minObs < 30) {
    errors.push('sparse_priors flag inconsistent with n_observations');
  }

  if (c.context.in_corpus === false && !['hors_corpus', 'escalade_legitime'].includes(c.meta.family)) {
    errors.push('in_corpus:false requires family hors_corpus or escalade_legitime');
  }

  if (c.symptom.code_absent_by_design && c.symptom.code_present !== null) {
    errors.push('code_absent_by_design requires code_present:null');
  }

  if (!c.harvest.reformulated) errors.push('harvest.reformulated must be true');

  if (errors.length) {
    return errors.map((e) => `${file}:${line} ${e}`);
  }
  return [];
}

function main() {
  const args = process.argv.slice(2);
  const pathsIdx = args.indexOf('--paths');
  const targets =
    pathsIdx >= 0
      ? args.slice(pathsIdx + 1)
      : [resolve(import.meta.dirname, '../dataset/pilot')];

  const files = targets.flatMap((p) => collectJsonlFiles(resolve(p)));
  if (files.length === 0) {
    console.error('No JSONL files found.');
    process.exit(1);
  }

  let total = 0;
  let failed = 0;

  for (const file of files) {
    const lines = readFileSync(file, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    for (const [index, line] of lines.entries()) {
      total += 1;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        failed += 1;
        console.error(`${file}:${index + 1} invalid JSON`);
        continue;
      }
      if (!validate(parsed)) {
        failed += 1;
        console.error(`${file}:${index + 1} schema`, validate.errors);
        continue;
      }
      const sem = validateSemantic(parsed as V2Case, file, index + 1);
      if (sem.length) {
        failed += 1;
        sem.forEach((e) => console.error(e));
      }
    }
  }

  if (failed > 0) {
    console.error(`Validation failed: ${failed}/${total}`);
    process.exit(1);
  }
  console.log(`Validated ${total} v2 cases across ${files.length} file(s).`);
}

main();
