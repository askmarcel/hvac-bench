# CI — secrets GitHub

Dépôt : https://github.com/askmarcel/hvac-bench

Le workflow `.github/workflows/hvac-bench-gate.yml` a deux jobs :

| Job | Secrets | Rôle |
|---|---|---|
| `harness` | aucun | schéma public + 18 tests (toujours vert/rouge honnête) |
| `gate` | voir ci-dessous | run bras D réel sur les 52 cas held-out |

## Secrets du job `gate` — configurés 2026-07-25

| Secret | Valeur actuelle | Usage |
|---|---|---|
| `BENCH_API_URL` | `https://app.askmarcel.app` | URL de prod (bras D) |
| `BENCH_API_KEY` | clé `HvacBench-CI` (`ak_live_5ab40292…`) | Créée via `AskMarcel-WebApp-NextJS/scripts/create-bench-ci-key.ts` |
| `HELDOUT_REPO` | `github.com/askmarcel/hvac-bench-heldout.git` | Dépôt privé held-out (fallback HTTPS) |
| `HELDOUT_DEPLOY_KEY` | clé SSH read-only `hvac-bench-ci-readonly-*` | **Préféré** — clone SSH du held-out |
| `HELDOUT_TOKEN` | *(à retirer)* | Ancien token `gh` personnel — remplacé par `HELDOUT_DEPLOY_KEY` |

Held-out : https://github.com/askmarcel/hvac-bench-heldout (privé)

Contenu requis côté held-out :

- `dataset/gate.jsonl`
- `index/corpus-index.json` (exporté via `export-bench-index.ts` dans la WebApp)

## Premier run

[Actions #30160899365](https://github.com/askmarcel/hvac-bench/actions/runs/30160899365) — harness ✅, gate **rouge** (attendu pré-correctif).

L'artefact `hvac-bench-score` contient `score.json`. À copier en `baselines/pre-fix.json` pour REQ-G3.

## Prérequis prod

1. **En-têtes de confiance** : `X-AM-Confidence-Band` / `-Score` sur `/diagnose` et `/diagnose/stream` — déployé ✅
2. **Quota** : la clé `HvacBench-CI` doit couvrir 52 diagnostics (+ marge re-scoring) — tier `business`, OK ✅
3. **Smoke test** (depuis la WebApp) :

```bash
BENCH_API_KEY=ak_live_… pnpm exec tsx scripts/check-confidence-headers.ts
```

Attendu : HTTP 200, bande `high`/`medium`/`low` (pas `unknown`), pas de 402 `quota_exceeded`.

## Tag schéma

Tag `dataset-schema-v0.1.0` poussé sur https://github.com/askmarcel/hvac-bench/releases/tag/dataset-schema-v0.1.0
