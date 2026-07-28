# Rapport bench v2 — dataset complet (~200 cas)

> Généré : 2026-07-25 · Phase 2 close

## Fichiers dataset

| Fichier | Cas | Split |
|---|---:|---|
| `hvac-bench-heldout/dataset/gate.jsonl` | 52 | held-out (CI, figé) |
| `hvac-bench/dataset/public/bench-v2.jsonl` | 148 | public |
| `hvac-bench/dataset/public/sample.jsonl` | 4 | public (illustratif) |
| **Total unique** | **204** | gate + bench-v2 + sample |

## Composition bench-v2 seul (148 cas)

| Strate | Cas | % |
|---|---:|---:|
| `forum` | 50 | 33,8 % |
| `marcel_trap` | 61 | 41,2 % |
| `no_answer` | 37 | 25,0 % |

REQ-P3 sur bench-v2 seul : forum et no_answer hors tolérance ±5 pts — attendu car le gate (52 cas) porte la part no_answer.

## Composition dataset complet (204 cas, IDs uniques)

| Strate | Cas | % | REQ-P3 cible |
|---|---:|---:|---|
| `no_answer` | 72 | 35,3 % | 35 % ±5 |
| `marcel_trap` | 82 | 40,2 % | 40 % ±5 |
| `forum` | 50 | 24,5 % | 25 % ±5 |

## Workflow secondaire (~30 cas)

Sous-échantillon suggéré pour annotation Marcel : cas `marcel_trap` public avec `citation_scorable: true` dans bench-v2.

IDs : `hb-0130` … `hb-0159` (30 cas).

## Commandes

```bash
cd AskMarcel-WebApp-NextJS
pnpm exec tsx scripts/generate-bench-v2-candidates.ts
pnpm exec tsx scripts/verify-gate-dataset.ts ../hvac-bench/dataset/public/bench-v2.jsonl

cd ../hvac-bench
pnpm validate:cases --paths dataset/public/bench-v2.jsonl
pnpm run:d -- --cases full --out runs/bench-v2-smoke
```

## Phase 3 — runs A/B/C/D sur 200 cas

```bash
pnpm run:a -- --cases full --out runs/bench-v2-arm-a
pnpm run:b -- --cases full --out runs/bench-v2-arm-b
pnpm run:c -- --cases full --out runs/bench-v2-arm-c
pnpm run:d -- --cases full --out runs/bench-v2-arm-d
```

Rapport comparatif : [bench-v2-full-2026-07-26.md](./reports/bench-v2-full-2026-07-26.md) (exécuté).

Template / historique : [bench-v2-full-2026-07-25.md](./reports/bench-v2-full-2026-07-25.md).
