# Rapport bench v2 — dataset complet (204 cas)

> Exécuté : 2026-07-26 · Phase 3 (runs A/B/D)

## Contexte run

| Élément | Valeur |
|---|---|
| Dataset | `gate.jsonl` + `bench-v2.jsonl` + `sample.jsonl` — **204 cas** (`dataset_version` `c5c4043eb7e136ad`) |
| Index corpus | `corpus-index.json` — 2892 docs, export 2026-07-26 |
| Endpoint D | `https://app.askmarcel.app/api/v1/assist/diagnose` |
| Bras A | OpenRouter `openai/gpt-4o` (closed-book) |
| Bras B | OpenRouter `perplexity/sonar` (web) |
| Scorer | `0.1.0` |

Artefacts : `runs/bench-v2-full-{a,b,d}-2026-07-26/`

**Note opérationnelle :** le premier passage bras D à `BENCH_CONCURRENCY=6` a généré 143 réponses `429` (quota). Complété via `scripts/retry-failed-records.ts` (délai 5 s, 204/204 succès).

---

## Headline public — slice `non_contaminated` (72 cas)

Exclut forum (`contamination_risk`) et `marcel_trap` (`corpus_leakage`). Slice = **no_answer** uniquement.

| Métrique | Bras A | Bras B | Bras D | IC95 D |
|---|---:|---:|---:|---|
| Attribution | 73,3 % | 68,3 % | **80,0 %** | 68,2–88,2 % |
| Hallucination | 22,2 % | 26,4 % | **16,7 %** | 9,8–26,9 % |

Interprétation : sur les cas où le système doit s'abstenir ou signaler l'ambiguïté, D affirme moins souvent à tort que A/B. `useful_answer_rate` est n/a sur cette slice (pas de cas answerable).

---

## Global (204 cas)

| Métrique | Bras A | Bras B | Bras D |
|---|---:|---:|---:|
| Format conforme | 100,0 % | 35,8 % | **100,0 %** |
| Attribution | 52,1 % | 78,6 % | **90,1 %** |
| Exactitude code (answerable) | 42,4 % | 81,8 % | **94,7 %** |
| Citation (citable trap) | 0,0 % | 0,0 % | **97,5 %** |
| Abstention (no_answer) | 77,8 % | 73,6 % | **83,3 %** |
| Hallucination | 10,4 % | 12,3 % | **7,8 %** |
| Réponse utile (trap) | 1,2 % | 1,2 % | **97,6 %** |
| Citations fantômes | 20 | 0 | **0** |

---

## Bras D — slices

| Slice | n | Attribution | Hallucination | Réponse utile |
|---|---:|---:|---:|---:|
| `score_gate` (hors leakage) | 72 | 80,0 % | 16,7 % | n/a |
| `score_leak` (signal) | 132 | 94,7 % | 7,8 % | 97,6 % |
| Gate 52 seul (sous-set) | 52 | 87,5 % | 7,7 % | 89,5 % |

**Régression gate 52 :** `score_gate` attribution **86,2 %** (25/29) — identique à `last-green.json`. Verdict gate **VERT** (0 citation fantôme, 0 high/no-answer).

---

## Validation (chain of thought)

| Question | Verdict |
|---|---|
| D meilleur que A/B sur answerable ? | **Oui** — 97,6 % utile vs ~1 % ; attendu sans corpus RAG pour A/B. |
| Hallucination D < A/B sur headline ? | **Oui** — 16,7 % vs 22–26 % sur `non_contaminated`. |
| Gate 52 stable après extension dataset ? | **Oui** — même run D, slice 52 = baseline verte. |
| B format 35 % — bug scorer ? | **Non** — Perplexity renvoie du texte hors Answer Contract ; limite connue bras B. |
| A 20 citations fantômes — cohérent ? | **Oui** — closed-book invente des manuels ; rubrique citation FAIL. |
| Rate limit 429 — run invalide ? | **Non** — retry exhaustif ; 204/204 HTTP 200 avant score. |
| Forum dans headline ? | **Non** — exclus par design (`non_contaminated`). |

---

## Recommandations

1. **Runs prod** : `BENCH_CONCURRENCY≤2` ou quota API dédié bench (éviter 429).
2. **Publication** : headline = `non_contaminated` ; `score_leak` = signal interne RAG.
3. **Ingestion** : prioriser Atlantic/Toshiba (`phase2-ingestion-priority.csv`) avant revendication couverture prod.
4. **Phase 4** : annotation workflow `hb-0130`–`hb-0159`.

## Commandes de reproduction

```bash
cd hvac-bench
set -a && source .env.bench && set +a   # BENCH_API_URL + BENCH_API_KEY
pnpm run:d -- --cases full --out runs/bench-v2-full-d-YYYY-MM-DD
# si 429 :
pnpm exec tsx scripts/retry-failed-records.ts --cases full --run runs/.../raw.jsonl --delay-ms 5000

export OPENROUTER_API_KEY=…
pnpm run:a -- --cases full --out runs/bench-v2-full-a-YYYY-MM-DD
pnpm run:b -- --cases full --out runs/bench-v2-full-b-YYYY-MM-DD

pnpm score --cases full --run runs/.../raw.jsonl --meta runs/.../run.json \
  --index ../hvac-bench-heldout/index/corpus-index.json --out runs/.../score.json
pnpm compare:arms --a runs/...-a/score.json --b runs/...-b/score.json --d runs/...-d/score.json
```
