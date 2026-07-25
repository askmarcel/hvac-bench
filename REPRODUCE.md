# Reproduire un run

## Prérequis

- Node 22, pnpm 9, `pnpm install`
- Clone https://github.com/askmarcel/hvac-bench-heldout (accès privé) ou copie locale `../hvac-bench-heldout/`
- `BENCH_API_URL` et `BENCH_API_KEY` pour le bras D (clé `HvacBench-CI` en CI)

## Chaîne complète

```bash
# 0. Le held-out doit passer le schéma avant tout run
pnpm validate:cases --paths ../hvac-bench-heldout/dataset/gate.jsonl

# 1. Index corpus (depuis le monorepo WebApp, une fois par run)
cd ../AskMarcel-WebApp-NextJS
pnpm exec tsx scripts/export-bench-index.ts ../hvac-bench-heldout/index/corpus-index.json
cd ../hvac-bench

# 2. Run bras D — le produit réel
BENCH_API_URL=https://… BENCH_API_KEY=… \
  pnpm run:d --cases ../hvac-bench-heldout/dataset/gate.jsonl --out runs/2026-07-25

# 3. Scorer
pnpm score --cases ../hvac-bench-heldout/dataset/gate.jsonl \
           --run runs/2026-07-25/raw.jsonl \
           --meta runs/2026-07-25/run.json \
           --index ../hvac-bench-heldout/index/corpus-index.json \
           --out runs/2026-07-25/score.json

# 4. Gate
pnpm gate --score runs/2026-07-25/score.json --baseline baselines/last-green.json
```

`pnpm test` vérifie le harnais lui-même sur réponses simulées, sans réseau ni secret.

## Ce qui rend un run comparable à un autre

Un run n'est comparable qu'à conditions égales sur ces cinq éléments, tous inscrits dans
`run.json` et `score.json` :

| Élément | Où il est figé |
|---|---|
| Version du dataset | `dataset_version` — sha256 tronqué du `gate.jsonl` |
| Version du contrat de réponse | `contract_version`, lu dans la première réponse |
| Version de l'index corpus | `index_version` — date d'export |
| Version du scorer | `scorer_version` |
| Bras | `arm` |

Changer l'un d'eux invalide la comparaison à la baseline. Le CDC §10 exige un amendement
daté avant tout re-run revendiqué comparable.

## Le run pré-correctif

Le premier run bras D est archivé en `baselines/pre-fix.json` — **preuve interne, jamais
baseline verte** (CDC REQ-G3).

**État 2026-07-25 :** exécuté via CI ([run #30160899365](https://github.com/askmarcel/hvac-bench/actions/runs/30160899365)), figé dans le dépôt (commit `718d2a8`).

## La baseline verte

Après split `score_gate` / `score_leak`, la baseline est figée en `baselines/last-green.json` :

- Run : `d-2026-07-25T19-58-56-240Z-83d39b5e`
- CI : [Actions #30172655627](https://github.com/askmarcel/hvac-bench/actions/runs/30172655627)
- Attribution de référence (**score_gate**, 33 cas hors `corpus_leakage`) : **86,2 %** (25/29)
- Citations fantômes : **0**
- Tranches : `score_gate` 33 cas · `score_leak` 19 cas (signal, non bloquant)

Tout push sur `main` compare la règle 1 (régression attribution) à `slices.score_gate.attribution_rate`
de cette baseline.

Run pré-split archivé : `d-2026-07-25T19-30-40-134Z-f8ef518d` ([#30161016782](https://github.com/askmarcel/hvac-bench/actions/runs/30161016782)), attribution globale 83,3 %.

Le runner écrit `raw.jsonl` au fil de l'eau pour qu'un plantage à mi-parcours ne le gâche pas.

## Déterminisme

Le scorer ne fait aucun appel réseau et n'utilise aucun LLM (NFR-4) : mêmes `raw.jsonl`,
`gate.jsonl` et index produisent le même `score.json`. Le runner, lui, interroge un système
en production : deux runs ne sont pas identiques, ce qui est la raison d'être des
intervalles de confiance à 95 %.

## Vérifier le dataset avant de dépenser un run

Depuis le monorepo WebApp :

```bash
pnpm exec tsx scripts/verify-gate-dataset.ts ../hvac-bench-heldout/dataset/gate.jsonl
```

Il confronte chaque cas à la base. Un code déclaré inexistant qui existe réellement pour la
marque citée est une vérité terrain inversée : le bench punirait alors le comportement
correct. C'est arrivé sur 6 cas de la v0.

## Bras A (closed-book)

```bash
# Prérequis : OPENROUTER_API_KEY ou BENCH_ARM_A_API_KEY
export BENCH_ARM_A_MODEL=openai/gpt-4o   # optionnel

pnpm run:a --cases ../hvac-bench-heldout/dataset/gate.jsonl --out runs/arm-a-2026-07-25
pnpm score --cases ../hvac-bench-heldout/dataset/gate.jsonl \
  --run runs/arm-a-2026-07-25/raw.jsonl --meta runs/arm-a-2026-07-25/run.json \
  --index ../hvac-bench-heldout/index/corpus-index.json \
  --out runs/arm-a-2026-07-25/score.json
pnpm compare:arms --a runs/arm-a-2026-07-25/score.json --d baselines/last-green.json
```

Rapport figé : [reports/arm-a-vs-d-2026-07-25.md](./reports/arm-a-vs-d-2026-07-25.md).
