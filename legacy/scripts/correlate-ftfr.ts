/**
 * Corrélation conv@3 pilote ↔ FTFR terrain (M3).
 * Usage: pnpm exec tsx scripts/correlate-ftfr.ts --pilot-runs runs/pilot-v2-d-* --ftfr-csv data/ftfr-terrain.csv
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

function pearson(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 3) return null;
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const vx = xs[i]! - mx;
    const vy = ys[i]! - my;
    num += vx * vy;
    dx += vx * vx;
    dy += vy * vy;
  }
  const den = Math.sqrt(dx * dy);
  return den ? num / den : null;
}

function main() {
  const report = {
    status: 'pending_ftfr_data',
    message: 'Brancher data/ftfr-terrain.csv quand disponible côté produit.',
    rho_conv3_ftfr: null as number | null,
  };
  const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '../reports');
  writeFileSync(
    resolve(outDir, `ftfr-correlation-${new Date().toISOString().slice(0, 10)}.json`),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(JSON.stringify(report, null, 2));
}

main();
