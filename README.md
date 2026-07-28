# HVAC Bench

Benchmark CVC AskMarcel — harness de mesure, dataset versionné, gate CI.

## Statut

| Élément | État |
|---|---|
| Dépôt | https://github.com/askmarcel/hvac-bench (public) |
| Held-out | https://github.com/askmarcel/hvac-bench-heldout (privé, secret CI) |
| Schéma cas | `dataset/schema.json` v0.1.0 — tag `dataset-schema-v0.1.0` |
| Gate held-out | 52 cas (`hvac-bench-heldout`, CI figé) |
| Bench v2 public | 148 cas, `dataset/public/bench-v2.jsonl` — Phase 2 (2026-07-25) |
| Dataset complet | **204 cas** = gate 52 + bench-v2 148 + sample 4 |
| Échantillon public | 4 cas, `dataset/public/sample.jsonl` — **hors gate** |
| Runner | bras D · bras **C** (MCP diagnose) · `--cases full` = 204 cas |
| Scorer | `pnpm score` — déterministe, sans LLM, 18 tests |
| Gate | `pnpm gate` — 4 règles (CDC §7 + confiance illisible) |
| CI | workflow `hvac-bench-gate` — 52 cas — **VERT** depuis 2026-07-25 |
| Baseline verte | `baselines/last-green.json` — attribution score_gate **86,2 %** |
| Baseline pre-fix | `baselines/pre-fix.json` — [#30160899365](https://github.com/askmarcel/hvac-bench/actions/runs/30160899365) |
| Bench complet | runs A/B/D 204 cas — [rapport 2026-07-26](./reports/bench-v2-full-2026-07-26.md) |
| Workflow Phase 4 | composite **2,62/5** (30 cas trap) — [rapport Hvac_Bench](../Hvac_Bench/prep/phase4-workflow-report.md) |

## Métriques headline

Hallucination × utilité, avec intervalles de Wilson à 95 %. Locale cible `fr`.

La tranche headline **`non_contaminated`** (72 cas sur 204) exclut :

- `contamination_risk` — vérité probablement dans le pré-entraînement (forums) ;
- `corpus_leakage` — vérité issue du corpus ingéré (trap + forum).

Sur cette slice, on ne publie pas `useful_answer_rate` (pas de cas answerable). Les trap citables (82 cas) sont dans **`score_leak`** — signal RAG interne, hors gate.

Détail bras, modèles et clés : [docs/BRAS-ET-CREDENTIALS.md](./docs/BRAS-ET-CREDENTIALS.md).

## Conventions de scoring

Deux endroits où le CDC laisse une marge d'interprétation. Les choix retenus sont
délibérés et testés.

### Attribution sur un cas answerable où le système s'abstient

Le CDC §4.1 définit PASS (marques équivalentes) et FAIL (marque différente, ou marque
affirmée sur un cas sans réponse attendue). Un cas answerable sur lequel le système
s'abstient n'affirme aucune marque : ni l'un ni l'autre.

Le traiter comme non applicable rendrait `attribution_rate` insensible à la sur-abstention —
un système qui refuse de répondre partout obtiendrait 100 %. C'est exactement la faille qui
rendait le gate v0 inopérant. **On le compte FAIL.** Un test (`s'abstenir partout ne donne
pas un bon score d'attribution`) verrouille ce comportement.

### Exactitude de code et sens

Le CDC §4.2 mentionne « sens contradictoire au manuel ». Un tel jugement n'est pas
décidable sans arbitrage humain, et le scorer s'interdit tout appel LLM (NFR-4).

La rubrique bloquante ne juge donc que **l'égalité du code**, à la casse et aux séparateurs
près. Le recouvrement lexical avec la vérité terrain est publié comme signal secondaire
(`signals.meaning_overlap`) et n'entre dans aucune métrique. Le jugement de sens relève de
la rubrique humaine `workflow` (§4.6), hors gate.

## Calibration du harnais

Trois systèmes simulés sont passés sur les 52 cas du gate pour vérifier que les métriques
se comportent comme attendu :

| Système simulé | Attribution | Abstention | Hallucination | Réponse utile | Verdict |
|---|---|---|---|---|---|
| Oracle (répond juste, s'abstient à propos) | 100 % | 100 % | 0 % | 100 % | vert |
| S'abstient toujours | 60 % | 100 % | 0 % | 0 % | **rouge** |
| Affirme toujours, confiance haute | 40 % | 0 % | 64 % | 0 % | **rouge** |

Le deuxième est le plus important : un système qui ne se trompe jamais parce qu'il ne
répond jamais doit être rouge. Il l'est, par la règle de régression d'attribution.

## Premier run prod (2026-07-25) — pré-correctif

Gate CI sur les 52 cas held-out, clé `HvacBench-CI`, prod `app.askmarcel.app`.
Artefact archivé en `baselines/pre-fix.json` — [Actions #30160899365](https://github.com/askmarcel/hvac-bench/actions/runs/30160899365).

| Métrique | Résultat |
|---|---|
| Attribution | 87,5 % (42/48) |
| Hallucination | 15,4 % (8/52) |
| Verdict gate | **ROUGE** |
| Règle 2 | ✗ hb-0042 (high sur no-answer) |
| Règle 3 | ✗ hb-0066…0069 (citations fantômes) |
| Règle 4 (confiance lisible) | ✓ |

## Correctif diagnose + gate vert (2026-07-25)

### Causes racines

| Cas | Symptôme | Correctif |
|---|---|---|
| hb-0042 | Requête symptom-only → `answer` + confiance haute | Détection `isSymptomOnlyUnderspecified` → `ambiguous` / `low` (`4fe3f6a`) |
| hb-0066…0069 | `doc_title` null → fallback « Manuel technique » | Chunks publiés sur documents `is_published = false` : le JOIN RPC filtrait `rd.is_published` ; migration `20260725213000_fix_search_rpc_doc_title.sql` + enrichissement admin (`e752394`) |

### Run post-correctif (baseline verte)

[Actions #30172655627](https://github.com/askmarcel/hvac-bench/actions/runs/30172655627) · run `d-2026-07-25T19-58-56-240Z-83d39b5e` · figé en `baselines/last-green.json` (slice `score_gate`).

| Métrique | Résultat |
|---|---|
| Attribution (**score_gate**, 33 cas) | **86,2 %** (25/29, IC95 ~69–95 %) |
| Citations fantômes | **0** |
| High sur no-answer | **0** (hb-0042 → `ambiguous` / `low`) |
| Confiance illisible | **0** |
| Verdict gate | **VERT** |

Run pré-split : [#30161016782](https://github.com/askmarcel/hvac-bench/actions/runs/30161016782) · attribution globale 83,3 %.

## Règles du gate

Trois règles du CDC §7 REQ-G2, plus une quatrième ajoutée ici et signalée comme hors CDC :

1. régression `attribution_rate` sous la baseline verte (ε configurable, défaut 0) ;
2. au moins une réponse affirmée avec confiance haute sur un cas sans réponse attendue ;
3. au moins une citation fantôme — manuel introuvable ou page hors bornes ;
4. *(hors CDC)* confiance illisible sur un cas bloquant : la règle 2 ne couvre alors pas ce
   cas, et un gate qui ne peut pas évaluer sa propre règle n'est pas déclaré vert.

La confiance ne figure pas dans le contrat de réponse ; elle est lue dans l'en-tête
`X-AM-Confidence-Band`. Si l'API ne l'expose pas, la règle 2 ne mesure rien — d'où la
règle 4.

## Limites connues

- **Gate CI** = bras D, 52 cas. **Bench complet** = A/B/D sur 204 cas (manuel).
- Bras D = **RAG prod**, pas un LLM chat ; A = `gpt-4o` closed-book ; B = `perplexity/sonar` web ([détail](./docs/BRAS-ET-CREDENTIALS.md)).
- Rapports : [gate 52 A/B vs D](./reports/arm-a-b-vs-d-2026-07-25.md) · [204 cas A/B/D](./reports/bench-v2-full-2026-07-26.md).
- La rubrique `safety` est reportée, non bloquante (CDC).
- Citation vérifiable seulement si extraction page-level ; ~127 docs sans pages dans l’index.
- Cas forum : `citation_scorable = false` par construction.
- Runs prod D : risque **429** si `BENCH_CONCURRENCY` trop élevé → `scripts/retry-failed-records.ts`.

## Dataset Phase 2 + run complet Phase 3

Composition REQ-P3 sur **204 cas** :

| Strate | Cas | % | Cible |
|---|---:|---:|---|
| `no_answer` | 72 | 35,3 % | 35 % ±5 |
| `marcel_trap` | 82 | 40,2 % | 40 % ±5 |
| `forum` | 50 | 24,5 % | 25 % ±5 |

Run A/B/D 2026-07-26 (204 cas) — headline `non_contaminated` :

| Métrique | A (gpt-4o) | B (sonar) | D (prod) |
|---|---:|---:|---:|
| Hallucination | 22,2 % | 26,4 % | **16,7 %** |
| Attribution | 73,3 % | 68,3 % | **80,0 %** |

Bras D global : réponse utile trap **97,6 %**, 0 citation fantôme. Gate 52 revalidé **VERT** sur le même run.

- Génération dataset : `AskMarcel-WebApp-NextJS/scripts/generate-bench-v2-candidates.ts`
- Audit corpus / ingestion : `Hvac_Bench/prep/phase2-demand-vs-corpus.md`, `phase2-ingestion-priority.csv`
- Rapport : [bench-v2-full-2026-07-26](./reports/bench-v2-full-2026-07-26.md)

## Calibration v2 (pilote Phase 7)

Le run `pilot-v2-live-2026-07-26` est **INVALIDE** — voir [`reports/audit-pilot-v2-instrumentation-2026-07-26.md`](./reports/audit-pilot-v2-instrumentation-2026-07-26.md).

```bash
export BENCH_ALLOW_PENDING_EXPERT_PATHS=1   # jusqu'à validation Marcel (review_status=approved)
pnpm run:v2:calibrate                     # O_plomberie=100%, O_plafond, R
pnpm run:v2:pilot-live                    # D + B/E + intégrité + compare (API + OpenRouter)
```

Pré-enregistrement : [`preregistration.md`](./preregistration.md). Scorer **v0.3.0** (+ legacy v0.1.0).

### Oracles diagnostic v2

| Oracle | Bras | Évidence | conv@5 baseline |
|---|---|---|---|
| **O_bayes** | (documenté) | Annotations par cas `tests[].discriminates` | **0,80** (15 diag.) — ne pas reconstruire |
| **O_bayes_db** | `pnpm run:v2:arm-o-bayes-db` | Matrice Supabase `diag_hypotheses` | mesuré à chaque run |
| **O_plumbing** | `pnpm run:v2:arm-o-plumbing` | **Tautologique** — rejoue `expert_path` | 100 % par construction |
| **D** | `pnpm run:v2:arm-d` | Moteur prod `/api/v2/diagnose` | à mesurer post-correctifs |

Décomposition : `O_bayes − O_bayes_db` = coût généricité matrice ; `O_bayes_db − D` = coût sélecteur.

### Ordre de travail diagnostic (2026-07-26)

1. **Invariant sélecteur** — `max_top_prior(D) > max_top_prior(R)` (`pnpm check:selector-invariant`) — rouge tant que le VOI reste sur OBS-*.
2. **Mesure EIG** — `pnpm measure:eig-pilot` (variance EIG, masse a priori) **avant** toute modification matrice.
3. **Enrichissement matrice** — spécificité = masse a priori ~0,5 / variance EIG, pas compte de causes ; `pnpm enrich:hypothesis-matrix`. Cible `O_bayes_db` conv@5 ≈ 0,45–0,50.
3. **Recascade** — O_bayes → O_bayes_db → D.
4. **Seuil conclusion** — balayage quand D conclut (`pending_matrix`, T=0,85).
5. **λ** — en dernier.

Bras **H** (`pnpm run:v2:arm-h`) : lançable en parallèle.

## Scripts

```bash
pnpm install
pnpm validate:cases:v2
pnpm validate:expert-paths
pnpm run:v2:calibrate
pnpm run:v2:pilot-live
pnpm check-run-integrity
pnpm run:v2:compare
pnpm check:selector-invariant  # invariant max_top_prior(D) > max_top_prior(R)
pnpm test               # harnais sur réponses simulées, sans réseau
pnpm run:d              # runner bras D
pnpm run:a              # runner bras A (closed-book LLM)
pnpm run:b              # runner bras B (LLM + web search)
pnpm run:c              # runner bras C (MCP tools/call diagnose)
pnpm export:workflow    # pack annotation Phase 4 (30 cas)
pnpm score:workflow     # agrège annotations Marcel
pnpm run:d --cases full # gate + bench-v2 + sample (204 cas)
pnpm compare:arms       # comparatif A/B vs D
pnpm exec tsx scripts/retry-failed-records.ts  # retry 429 bras D
pnpm score              # scorer (`--cases full` supporté)
pnpm gate               # verdict CI (52 cas)
```

Voir [REPRODUCE.md](./REPRODUCE.md) · [SETUP-CI.md](./SETUP-CI.md) · [Bras & credentials](./docs/BRAS-ET-CREDENTIALS.md) · [Phase 4 workflow](../../Hvac_Bench/doc_Hvac_Bench_Phase4_Workflow.md).
