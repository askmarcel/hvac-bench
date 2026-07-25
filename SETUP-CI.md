# CI — secrets GitHub

Le workflow `.github/workflows/hvac-bench-gate.yml` a deux jobs :

| Job | Secrets | Rôle |
|---|---|---|
| `harness` | aucun | schéma public + 18 tests (toujours vert/rouge honnête) |
| `gate` | voir ci-dessous | run bras D réel sur les 52 cas held-out |

## Secrets du job `gate`

Configurer dans **Settings → Secrets and variables → Actions** du dépôt `hvac-bench` :

| Secret | Exemple | Usage |
|---|---|---|
| `BENCH_API_URL` | `https://app.askmarcel.app` | URL de prod (bras D) |
| `BENCH_API_KEY` | `ak_live_…` | Clé **HvacBench** (secret, scopes docs/catalog/pdf) — pas la clé redteam |
| `HELDOUT_REPO` | `github.com/askmarcel/hvac-bench-heldout.git` | Dépôt privé held-out |
| `HELDOUT_TOKEN` | PAT `repo` | Clone du held-out en CI |

Le held-out doit contenir :

- `dataset/gate.jsonl`
- `index/corpus-index.json` (exporté via `export-bench-index.ts` dans la WebApp)

## Prérequis prod avant le premier gate

1. **En-têtes de confiance** : `X-AM-Confidence-Band` / `-Score` sur `/diagnose` et `/diagnose/stream` (hors contrat).
2. **Quota** : la clé HvacBench doit avoir assez d'appels mensuels pour 52 diagnostics (+ marge re-scoring).
3. **Smoke test** (depuis la WebApp) :

```bash
BENCH_API_KEY=ak_live_… pnpm exec tsx scripts/check-confidence-headers.ts
```

Attendu : HTTP 200, bande `high`/`medium`/`low` (pas `unknown`), pas de 402 `quota_exceeded`.

## Tag schéma

Après le premier commit :

```bash
git tag dataset-schema-v0.1.0
git push origin dataset-schema-v0.1.0
```
