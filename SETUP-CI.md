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
| [#30172655627](https://github.com/askmarcel/hvac-bench/actions/runs/30172655627) | 2026-07-25 | **VERT** | Split `score_gate`/`score_leak` — baseline `last-green.json` avec slice gate (86,2 %) |

## Prérequis prod

1. **En-têtes de confiance** : `X-AM-Confidence-Band` / `-Score` sur `/diagnose` et `/diagnose/stream` — déployé ✅
2. **Quota** : la clé `HvacBench-CI` doit couvrir les diagnostics du job CI (**52 cas**). Un run local **204 cas** peut nécessiter une clé dédiée et `BENCH_CONCURRENCY≤2` (sinon 429 → `scripts/retry-failed-records.ts`).
3. **doc_title** : RPC `api_search_chunks_error` / `api_search_chunks_vector` sans filtre `is_published` sur le JOIN document — migration `20260725213000` ✅
4. **Smoke test** (depuis la WebApp, avec la clé CI) :

```bash
BENCH_API_KEY=ak_live_… pnpm exec tsx scripts/check-confidence-headers.ts
```

Attendu : HTTP 200, bande `high`/`medium`/`low` (pas `unknown`), pas de 402 `quota_exceeded`.

> La clé locale du `.env` peut être épuisée (402) sans impact sur le gate CI.

## Tag schéma

Tag `dataset-schema-v0.1.0` poussé sur https://github.com/askmarcel/hvac-bench/releases/tag/dataset-schema-v0.1.0

---

## Workflow `am-harness` (bench Harnais-AskMarcel — T4–T12)

Fichier : `.github/workflows/am-harness.yml`

| Job | Secrets | Rôle |
|---|---|---|
| `mechanical` | aucun | `am:validate-cases` + `am:check-scorer` |
| `llm-checks` | `AM_SIM_*`, `AM_JUDGE_*` (+ fallback `OPENROUTER_API_KEY`) | `am:check-sim` 5/5, `am:check-judge` 6/6 |
| `e2e-dry-run` | `AM_HARNESS_*` + simulateur | T10 — `workflow_dispatch` avec `run_e2e=true` |
| `gate-run` | idem | T12 — `workflow_dispatch` avec `run_gate=true` |

### Secrets AM à configurer (repo hvac-bench)

| Secret | Usage |
|---|---|
| `AM_SIM_MODEL` | Modèle simulateur installateur |
| `AM_SIM_API_KEY` | Clé API simulateur (ou `OPENROUTER_API_KEY`) |
| `AM_JUDGE_MODEL` | Modèle juge — **distinct** du simulateur et du bras |
| `AM_JUDGE_API_KEY` | Clé API juge |
| `AM_HARNESS_URL` | URL WebApp (`https://app.askmarcel.app` ou preview) |
| `AM_HARNESS_BEARER_TOKEN` | JWT Supabase utilisateur bench (auth `/api/mobile/chat`) |
| `AM_HARNESS_MODEL_ID` | Modèle bras testé (ex. `fast-marcel`) |
| `OPENROUTER_API_KEY` | Fallback partagé |
| `WEBAPP_REPO_TOKEN` | (optionnel) checkout WebApp pour e2e local CI |

### Token harness

Créer un utilisateur Supabase dédié bench. Le header `x-bench-mode: 1` contourne quotas/persistance mais **pas** l'auth Bearer.

### Scripts npm AM

```bash
pnpm am:validate-cases    # schéma + règles métier
pnpm am:check-scorer      # fixtures mécaniques (sans LLM)
pnpm am:check-sim         # 5 dialogues contrôle
pnpm am:check-judge       # 6 transcripts + variance
pnpm am:dry-run           # T10 : 2 cas × 3 bras
pnpm am:run-iteration     # T11/T12 : split dev ou gate
pnpm am:score --run runs/…
pnpm am:report --scores runs/…/score.json
pnpm am:stamp-marcel --date YYYY-MM-DD --all
pnpm am:split-dev-gate --seed 20260728 --apply
```

