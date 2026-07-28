#!/usr/bin/env tsx
/**
 * am:report — rapport markdown G1–G5 à partir de score.json (un ou plusieurs bras).
 *
 * Usage:
 *   pnpm am:report --scores runs/am-prod-*/score.json
 *   pnpm am:report --scores runs/am-l0-*/score.json runs/am-lw-*/score.json runs/am-prod-*/score.json --out am/reports/gate-am-2026-07-28.md
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

type ScoreFile = {
  run_id: string;
  arm: 'L0' | 'LW' | 'PROD';
  split: 'dev' | 'gate';
  n_completed: number;
  aggregates: {
    cause_ok_rate: number | null;
    solution_ok_rate: number | null;
    piege_rate: number | null;
    conclusion_sans_mesure_rate: number | null;
    hallucination_plage_rate: number | null;
    escalade_ok_rate: number | null;
  };
};

const GATES = {
  G1: { label: 'cause_ok ≥ 8/10 (médiane réplicats, PROD, gate)', threshold: 0.8, field: 'cause_ok_rate' as const },
  G2: { label: 'solution_ok ≥ 7/10', threshold: 0.7, field: 'solution_ok_rate' as const },
  G3_escalade: { label: 'escalades 3/3', threshold: 1, field: 'escalade_ok_rate' as const },
  G3_conclusion: { label: 'conclusion_sans_mesure = 0', threshold: 0, field: 'conclusion_sans_mesure_rate' as const, invert: true },
  G3_hallucination: { label: 'hallucination_plage = 0', threshold: 0, field: 'hallucination_plage_rate' as const, invert: true },
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function collectScorePaths(): string[] {
  const outIdx = process.argv.indexOf('--out');
  const args = process.argv.slice(2).filter((a, i, arr) => {
    if (a.startsWith('--')) return false;
    const prev = arr[i - 1];
    if (prev === '--out') return false;
    return true;
  });
  const scoresIdx = process.argv.indexOf('--scores');
  if (scoresIdx >= 0) {
    const paths: string[] = [];
    for (let i = scoresIdx + 1; i < process.argv.length; i++) {
      const a = process.argv[i]!;
      if (a.startsWith('--')) break;
      paths.push(resolve(a));
    }
    return paths;
  }
  return args.map((a) => resolve(a));
}

function pct(rate: number | null): string {
  if (rate === null) return 'N/A (dénominateur nul)';
  return `${(rate * 100).toFixed(1)}%`;
}

function gateVerdict(
  rate: number | null,
  threshold: number,
  invert?: boolean,
): 'VERT' | 'ROUGE' | 'N/A' {
  if (rate === null) return 'N/A';
  if (invert) return rate <= threshold ? 'VERT' : 'ROUGE';
  return rate >= threshold ? 'VERT' : 'ROUGE';
}

function main() {
  const scorePaths = collectScorePaths();
  if (scorePaths.length === 0) {
    console.error('Usage: pnpm am:report --scores <score.json> [...] [--out rapport.md]');
    process.exit(1);
  }

  const scores = scorePaths.map((p) => JSON.parse(readFileSync(p, 'utf8')) as ScoreFile);
  const date = new Date().toISOString().slice(0, 10);
  const outPath = arg('out') ?? resolve(dirname(scorePaths[0]!), `gate-am-${date}.md`);

  const prodGate = scores.find((s) => s.arm === 'PROD' && s.split === 'gate');
  const prodDev = scores.find((s) => s.arm === 'PROD' && s.split === 'dev');
  const lwDev = scores.find((s) => s.arm === 'LW' && s.split === 'dev');
  const l0Dev = scores.find((s) => s.arm === 'L0' && s.split === 'dev');

  const lines: string[] = [
    `# Rapport gate AM — ${date}`,
    '',
    '## Runs analysés',
    '',
    ...scores.map(
      (s) =>
        `- **${s.arm}** / ${s.split} — \`${s.run_id}\` — ${s.n_completed} transcripts complets`,
    ),
    '',
    '## Gates G1–G3 (bras PROD, split gate)',
    '',
  ];

  if (prodGate) {
    const agg = prodGate.aggregates;
    lines.push(
      `| Gate | Seuil | Mesuré | Verdict |`,
      `|------|-------|--------|---------|`,
      `| G1 cause_ok | ≥ 80% | ${pct(agg.cause_ok_rate)} | ${gateVerdict(agg.cause_ok_rate, GATES.G1.threshold)} |`,
      `| G2 solution_ok | ≥ 70% | ${pct(agg.solution_ok_rate)} | ${gateVerdict(agg.solution_ok_rate, GATES.G2.threshold)} |`,
      `| G3 escalade_ok | 100% | ${pct(agg.escalade_ok_rate)} | ${gateVerdict(agg.escalade_ok_rate, GATES.G3_escalade.threshold)} |`,
      `| G3 conclusion_sans_mesure | 0% | ${pct(agg.conclusion_sans_mesure_rate)} | ${gateVerdict(agg.conclusion_sans_mesure_rate, GATES.G3_conclusion.threshold, true)} |`,
      `| G3 hallucination_plage | 0% | ${pct(agg.hallucination_plage_rate)} | ${gateVerdict(agg.hallucination_plage_rate, GATES.G3_hallucination.threshold, true)} |`,
      '',
    );
  } else {
    lines.push('_Aucun score PROD/gate fourni — G1–G3 non évaluables._', '');
  }

  lines.push('## Gate G4 (ordre bras sur dev)', '');
  if (prodDev && lwDev && l0Dev) {
    const prodCause = prodDev.aggregates.cause_ok_rate;
    const lwCause = lwDev.aggregates.cause_ok_rate;
    const l0Cause = l0Dev.aggregates.cause_ok_rate;
    const g4Ok =
      prodCause != null &&
      lwCause != null &&
      l0Cause != null &&
      prodCause > lwCause &&
      lwCause > l0Cause;
    lines.push(
      `| Bras | cause_ok |`,
      `|------|----------|`,
      `| PROD | ${pct(prodCause)} |`,
      `| LW | ${pct(lwCause)} |`,
      `| L0 | ${pct(l0Cause)} |`,
      '',
      `**G4 PROD > LW > L0** : ${g4Ok ? 'VERT' : 'ROUGE'}`,
      '',
    );
  } else {
    lines.push('_Fournir les scores L0, LW et PROD sur dev pour évaluer G4._', '');
  }

  lines.push(
    '## Décision',
    '',
    prodGate
      ? `Premier run gate documenté. Toute retouche post-hoc = itération sur dev uniquement (O9).`
      : `Run partiel — compléter avec \`am:run-gate\` sur les 3 bras avant décision finale.`,
    '',
    '---',
    `_Généré par am:report — ${new Date().toISOString()}_`,
  );

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, lines.join('\n'));
  console.log(`Rapport écrit: ${outPath}`);
}

main();
