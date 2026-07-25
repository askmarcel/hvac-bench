# HVAC Bench

Benchmark CVC AskMarcel — harness de mesure, dataset versionné, gate CI.

## Statut

| Élément | État |
|---|---|
| Dépôt | https://github.com/askmarcel/hvac-bench (public) |
| Held-out | https://github.com/askmarcel/hvac-bench-heldout (privé, secret CI) |
| Schéma cas | `dataset/schema.json` v0.1.0 — tag `dataset-schema-v0.1.0` |
| Gate held-out | 52 cas |
| Échantillon public | 4 cas, `dataset/public/sample.jsonl` — **hors gate** |
| Runner | bras D (`pnpm run:d`) |
| Scorer | `pnpm score` — déterministe, sans LLM, 18 tests |
| Gate | `pnpm gate` — 4 règles (CDC §7 + confiance illisible) |
| CI | workflow `hvac-bench-gate` — harness + gate sur push |
| Baseline verte | figée — run `d-2026-07-25T19-30-40-134Z-f8ef518d` ([CI #30161016782](https://github.com/askmarcel/hvac-bench/actions/runs/30161016782)) |
| Baseline pre-fix | `baselines/pre-fix.json` — run [#30160899365](https://github.com/askmarcel/hvac-bench/actions/runs/30160899365) |
| CI | workflow `hvac-bench-gate` — harness + gate sur push — **VERT** depuis 2026-07-25 |

## Métriques headline

Hallucination × utilité, avec intervalles de Wilson à 95 %. Locale cible `fr` (3 cas sur 52
sont des requêtes de production en anglais, conservées telles quelles).

La tranche headline `non_contaminated` exclut deux populations :

- `contamination_risk` — vérité probablement présente dans le pré-entraînement des modèles ;
- `corpus_leakage` — vérité issue d'un document ingéré dans le corpus AskMarcel, ce qui
  donne un avantage trivial aux bras C et D. **Les 20 cas answerable sont dans ce cas** :
  ils servent le gate, pas le claim public.

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

- Gate = bras D uniquement. Bras A et B implémentés — voir [rapport A/B vs D](./reports/arm-a-b-vs-d-2026-07-25.md).
- La rubrique `safety` applique un jeu de règles v1 (fluide frigorigène, 230 V, gaz). Elle
  est reportée mais **non bloquante**, conformément au CDC. Elle déclenche sur hb-0065, dont
  la notice constructeur dit « compléter le réfrigérant manquant » : c'est voulu, la réponse
  attendue assortit l'instruction d'une mention de qualification.
- La citation n'est vérifiable que sur les documents à extraction page-level. 127 documents
  du corpus n'en ont pas ; hb-0004 est de ceux-là et porte `citation_scorable: false`.
- Cas forum : `citation_scorable = false` par construction.
- Amendements schéma : tag `dataset-schema-vX` + entrée datée au CDC §10.

## Scripts

```bash
pnpm install
pnpm validate:cases     # dataset contre le schéma
pnpm test               # harnais sur réponses simulées, sans réseau
pnpm run:d              # runner bras D
pnpm run:a              # runner bras A (closed-book LLM)
pnpm run:b              # runner bras B (LLM + web search)
pnpm compare:arms       # comparatif A/B vs D
pnpm score              # scorer
pnpm gate               # verdict CI
```

Voir [REPRODUCE.md](./REPRODUCE.md) · [SETUP-CI.md](./SETUP-CI.md) · [Rapport A/B vs D](./reports/arm-a-b-vs-d-2026-07-25.md).
