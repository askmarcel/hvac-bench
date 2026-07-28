import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

const schemaPath = resolve(import.meta.dirname, '../dataset/schema.json');
const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
const validate = ajv.compile(schema);

function collectJsonlFiles(target: string): string[] {
  const stat = statSync(target, { throwIfNoEntry: false });
  if (!stat) return [];
  if (stat.isFile() && target.endsWith('.jsonl')) return [target];
  if (!stat.isDirectory()) return [];
  const files: string[] = [];
  for (const entry of readdirSync(target)) {
    files.push(...collectJsonlFiles(resolve(target, entry)));
  }
  return files;
}

function parseArgs(): string[] {
  const args = process.argv.slice(2);
  const pathsIdx = args.indexOf('--paths');
  if (pathsIdx >= 0) {
    return args.slice(pathsIdx + 1);
  }
  return [
    resolve(import.meta.dirname, '../dataset/public'),
    resolve(import.meta.dirname, '../../hvac-bench-heldout/dataset'),
  ];
}

function main() {
  const targets = parseArgs();
  const files = targets.flatMap((p) => collectJsonlFiles(resolve(p)));
  if (files.length === 0) {
    console.error('No JSONL files found to validate.');
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
        console.error(`${file}:${index + 1} schema error`, validate.errors);
      }
    }
  }

  if (failed > 0) {
    console.error(`Validation failed: ${failed}/${total} cases invalid`);
    process.exit(1);
  }

  console.log(`Validated ${total} cases across ${files.length} file(s).`);
}

main();
