# Reproduire un run

## Prérequis

- Node 22, pnpm 9, `pnpm install`
- Clone https://github.com/askmarcel/hvac-bench-heldout (privé) ou copie locale `../hvac-bench-heldout/`
- Credentials — voir [docs/BRAS-ET-CREDENTIALS.md](./docs/BRAS-ET-CREDENTIALS.md)

| Bras | Variables |
|---|---|
| D | `BENCH_API_URL`, `BENCH_API_KEY` (`ak_live_…`) |
| A / B | `OPENROUTER_API_KEY` (ou `BENCH_ARM_*_API_KEY`) |

Fichier local recommandé (gitignored) :

```bash
# hvac-bench/.env.bench
BENCH_API_URL=https://app.askmarcel.app
BENCH_API_KEY=ak_live_…
```

Créer une clé bench : `cd ../AskMarcel-WebApp-NextJS && pnpm exec tsx scripts/create-bench-ci-key.ts`

## Chaîne complète (gate 52 cas)

```bash
# 0. Schéma
pnpm validate:cases --paths ../hvac-bench-heldout/dataset/gate.jsonl
pnpm validate:cases --paths dataset/public/bench-v2.jsonl dataset/public/sample.jsonl

# 1. Index corpus (monorepo WebApp)
cd ../AskMarcel-WebApp-NextJS
NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
  pnpm exec tsx scripts/export-bench-index.ts ../hvac-bench-heldout/index/corpus-index.json
cd ../hvac-bench

# 2. Run bras D
set -a && source .env.bench && set +a
pnpm run:d --cases ../hvac-bench-heldout/dataset/gate.jsonl --out runs/gate-d-YYYY-MM-DD

# 3. Scorer + gate
pnpm score --cases ../hvac-bench-heldout/dataset/gate.jsonl \
  --run runs/gate-d-YYYY-MM-DD/raw.jsonl \
  --meta runs/gate-d-YYYY-MM-DD/run.json \
  --index ../hvac-bench-heldout/index/corpus-index.json \
  --out runs/gate-d-YYYY-MM-DD/score.json

pnpm gate --score runs/gate-d-YYYY-MM-DD/score.json --baseline baselines/last-green.json
```

## Dataset complet (204 cas)

```bash
set -a && source .env.bench && set +a
export BENCH_CONCURRENCY=2   # éviter 429 sur prod
pnpm run:d --cases full --out runs/bench-v2-full-d-YYYY-MM-DD

# Si 429 :
pnpm exec tsx scripts/retry-failed-records.ts \
  --cases full --run runs/bench-v2-full-d-YYYY-MM-DD/raw.jsonl --delay-ms 5000

export OPENROUTER_API_KEY=…
pnpm run:a --cases full --out runs/bench-v2-full-a-YYYY-MM-DD
pnpm run:b --cases full --out runs/bench-v2-full-b-YYYY-MM-DD

pnpm score --cases full \
  --run runs/bench-v2-full-d-YYYY-MM-DD/raw.jsonl \
  --meta runs/bench-v2-full-d-YYYY-MM-DD/run.json \
  --index ../hvac-bench-heldout/index/corpus-index.json \
  --out runs/bench-v2-full-d-YYYY-MM-DD/score.json

pnpm compare:arms \
  --a runs/bench-v2-full-a-YYYY-MM-DD/score.json \
  --b runs/bench-v2-full-b-YYYY-MM-DD/score.json \
  --d runs/bench-v2-full-d-YYYY-MM-DD/score.json
```

Référence : [reports/bench-v2-full-2026-07-26.md](./reports/bench-v2-full-2026-07-26.md).

`pnpm test` vérifie le harnais sur réponses simulées, sans réseau.

## Comparabilité des runs

| Élément | Où figé |
|---|---|
| Dataset | `dataset_version` dans `run.json` / `score.json` |
| Contrat | `contract_version` (première réponse D) |
| Index | `index_version` — date export `corpus-index.json` |
| Scorer | `scorer_version` |
| Bras | `arm` + modèle dans `run.json` (`endpoint`) |

Changer l’un invalide la comparaison à la baseline (CDC §10).

## Baseline verte (gate 52)

- Fichier : `baselines/last-green.json`
- Run : `d-2026-07-25T19-58-56-240Z-83d39b5e`
- Attribution **score_gate** : **86,2 %** (25/29)
- Pré-correctif archivé : `baselines/pre-fix.json` — jamais baseline publique

Le runner écrit `raw.jsonl` au fil de l'eau.

## Déterminisme

Scorer : déterministe, sans réseau (NFR-4). Runners prod / OpenRouter : non déterministes → intervalles Wilson 95 %.

## Vérifier le dataset (avant un run coûteux)

```bash
cd ../AskMarcel-WebApp-NextJS
pnpm exec tsx scripts/verify-gate-dataset.ts ../hvac-bench-heldout/dataset/gate.jsonl
pnpm exec tsx scripts/verify-gate-dataset.ts ../hvac-bench/dataset/public/bench-v2.jsonl
```

## Générer bench-v2.jsonl

```bash
cd ../AskMarcel-WebApp-NextJS
pnpm exec tsx scripts/seed-bench-v2-lists.ts      # optionnel, Supabase
pnpm exec tsx scripts/generate-bench-v2-candidates.ts
cd ../hvac-bench
pnpm validate:cases --paths dataset/public/bench-v2.jsonl
```

## Bras A / B (gate 52 — historique)

Rapports figés sur 52 cas : [arm-a-vs-d](./reports/arm-a-vs-d-2026-07-25.md), [arm-a-b-vs-d](./reports/arm-a-b-vs-d-2026-07-25.md).

```bash
export OPENROUTER_API_KEY=…
export BENCH_ARM_A_MODEL=deepseek/deepseek-v4-flash  # défaut (models-v2.json)
export BENCH_ARM_B_MODEL=mistralai/mistral-large-2512 # défaut (models-v2.json, même modèle que E)
export BENCH_ARM_E_MODEL=mistralai/mistral-large-2512 # bras E pilote v2

pnpm run:a --cases ../hvac-bench-heldout/dataset/gate.jsonl --out runs/arm-a-YYYY-MM-DD
pnpm run:b --cases ../hvac-bench-heldout/dataset/gate.jsonl --out runs/arm-b-YYYY-MM-DD
```

## Bras C (MCP diagnose)

```bash
set -a && source .env.bench && set +a
pnpm run:c --cases ../hvac-bench-heldout/dataset/gate.jsonl --out runs/gate-c-YYYY-MM-DD
pnpm compare:arms --c runs/gate-c-YYYY-MM-DD/score.json --d runs/.../score-gate52.json
```

Rapport : [reports/arm-c-vs-d-gate52.md](./reports/arm-c-vs-d-gate52.md).

## Phase 4 — annotation workflow

```bash
pnpm export:workflow --run runs/bench-v2-full-d-2026-07-26/raw.jsonl
pnpm score:workflow --in workflow/phase4-annotations.json
```

Guide : [Hvac_Bench/doc_Hvac_Bench_Phase4_Workflow.md](../Hvac_Bench/doc_Hvac_Bench_Phase4_Workflow.md).
