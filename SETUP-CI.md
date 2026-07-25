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
| `HELDOUT_DEPLOY_KEY` | clé SSH read-only `hvac-bench-ci-readonly-20260725` | **Préféré** — clone SSH du held-out |
| `HELDOUT_REPO` | `github.com/askmarcel/hvac-bench-heldout.git` | Fallback HTTPS (optionnel si deploy key présente) |

> `HELDOUT_TOKEN` (ancien token `gh` personnel) a été **supprimé** le 2026-07-25 et remplacé par `HELDOUT_DEPLOY_KEY`.

Held-out : https://github.com/askmarcel/hvac-bench-heldout (privé)

Contenu requis côté held-out :

- `dataset/gate.jsonl`
- `index/corpus-index.json` (exporté via `export-bench-index.ts` dans la WebApp)

## Historique des runs CI

| Run | Date | Verdict | Notes |
|---|---|---|---|
| [#30160899365](https://github.com/askmarcel/hvac-bench/actions/runs/30160899365) | 2026-07-25 | **ROUGE** | Premier run prod — preuve pré-correctif → `baselines/pre-fix.json` |
| [#30161016782](https://github.com/askmarcel/hvac-bench/actions/runs/30161016782) | 2026-07-25 | **VERT** | Post-correctif diagnose — baseline verte → `baselines/last-green.json` |
| [#30171776804](https://github.com/askmarcel/hvac-bench/actions/runs/30171776804) | 2026-07-25 | **VERT** | Validation deploy key SSH + baselines commitées (`718d2a8`) |

## Prérequis prod

1. **En-têtes de confiance** : `X-AM-Confidence-Band` / `-Score` sur `/diagnose` et `/diagnose/stream` — déployé ✅
2. **Quota** : la clé `HvacBench-CI` doit couvrir 52 diagnostics (+ marge re-scoring) — tier `business`, OK ✅
3. **doc_title** : RPC `api_search_chunks_error` / `api_search_chunks_vector` sans filtre `is_published` sur le JOIN document — migration `20260725213000` ✅
4. **Smoke test** (depuis la WebApp, avec la clé CI) :

```bash
BENCH_API_KEY=ak_live_… pnpm exec tsx scripts/check-confidence-headers.ts
```

Attendu : HTTP 200, bande `high`/`medium`/`low` (pas `unknown`), pas de 402 `quota_exceeded`.

> La clé locale du `.env` peut être épuisée (402) sans impact sur le gate CI.

## Tag schéma

Tag `dataset-schema-v0.1.0` poussé sur https://github.com/askmarcel/hvac-bench/releases/tag/dataset-schema-v0.1.0
