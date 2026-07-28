/**
 * Fusionne les runs D/B/E/R en un dossier unique pour compare.
 *
 * Usage: pnpm merge:arm-runs -- --out runs/pilot-v2-live-YYYY-MM-DD --d runs/... --b runs/... --e runs/...
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main() {
  const out = resolve(arg('out') ?? 'runs/pilot-v2-merged');
  const dDir = resolve(arg('d')!);
  const bDir = resolve(arg('b')!);
  const eDir = resolve(arg('e')!);
  const calDir = arg('calibration') ? resolve(arg('calibration')!) : null;
  const rDir = arg('r') ? resolve(arg('r')!) : null;

  mkdirSync(out, { recursive: true });

  copyFileSync(resolve(dDir, 'score-d.json'), resolve(out, 'score-d.json'));
  copyFileSync(resolve(bDir, 'score-b.json'), resolve(out, 'score-b.json'));
  copyFileSync(resolve(eDir, 'score-e.json'), resolve(out, 'score-e.json'));

  const raw = [
    readFileSync(resolve(dDir, 'raw.jsonl'), 'utf8'),
    readFileSync(resolve(bDir, 'raw.jsonl'), 'utf8'),
    readFileSync(resolve(eDir, 'raw.jsonl'), 'utf8'),
  ].join('');
  writeFileSync(resolve(out, 'raw.jsonl'), raw);

  if (rDir && existsSync(resolve(rDir, 'score-r.json'))) {
    copyFileSync(resolve(rDir, 'score-r.json'), resolve(out, 'score-r.json'));
  }
  if (calDir && existsSync(resolve(calDir, 'calibration.json'))) {
    copyFileSync(resolve(calDir, 'calibration.json'), resolve(out, 'calibration.json'));
  }

  const manifest = JSON.parse(readFileSync(resolve(dDir, 'manifest.json'), 'utf8'));
  writeFileSync(
    resolve(out, 'manifest.json'),
    JSON.stringify(
      {
        ...manifest,
        mode: 'live',
        arms: ['D', 'B', 'E'],
        sources: { D: dDir, B: bDir, E: eDir },
        merged_at: new Date().toISOString(),
      },
      null,
      2,
    ) + '\n',
  );

  console.log(`Merged into ${out}`);
}

main();
