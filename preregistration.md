# Pré-enregistrement — calibration HVAC Bench v2 (pilote)

Version : 2026-07-26-rev2  
Corpus : `dataset/pilot/pilot-v2.jsonl` (20 cas)

## Question

L'API diagnostique v2 (bras D) est-elle plus performante qu'un LLM frontier seul (B, E) sur convergence à la vraie cause ?

## Métrique primaire

`convergence_at_3` au niveau **cas**, agrégation **`pass^3`** (3 réplicats doivent tous converger correctement).

## Métriques secondaires

- `top3_accuracy` (vraie cause dans top-3 hypothèses finales)
- `premature_closure_rate` (dénominateur = sessions conclues, scorer v0.2.0)
- `escalation_precision` (FP sur tout cas non-`escalade_legitime`, scorer v0.2.0)
- `path_cost_ratio` conditionné convergence correcte (`n_eligible ≥ 10` sinon `n/a`)

## Ordre d'exécution (bloquant)

1. Validation Marcel `expert_path` (20/20 `review_status=approved`)
2. Calibration : O_plomberie (100 % strict), O_plafond, R
3. Correctif observations neutres (registre complet)
4. Checkpoint D post-2a
5. Hygiène sélecteur ESC (si nécessaire)
6. `check-run-integrity` (dégénérescence)
7. Bras D / B / E
8. Compare avec gate calibration

## Seuils et règles d'arrêt

| Contrôle | Seuil | Action si échec |
|----------|-------|-----------------|
| O_plomberie conv@5 | = 100 % | STOP — harnais ou cas cassés |
| ESC en `next_action` | 0 | FAIL intégrité |
| `expert_path_first_hit_rate` | > 0 (bras D) | FAIL intégrité — sélecteur dégénéré coût-min |
| `distinct_paths / n_cases` | informatif | retiré post-S1 (tie-break déterministe) |
| `H(première action)` | informatif | retiré post-S1 |
| R ≥ bras réel (métrique headline) | interdit | métrique DISQUALIFIED |
| Calibration `status` | `green` | compare refuse verdict |

## Réplicats

- Bras déterministe (D) : 1 réplicat après détection run 1
- Bras stochastiques (B, E) : 3 réplicats
- McNemar : niveau cas, IC Wilson 95 %

## Dimensionnement held-out

Mesurer taux de paires discordantes **après** décollage du plancher ; ne pas fixer n avant mesure (régime ~8 % discordant → ~300+ cas pour puissance McNemar).

## Scorer

Double score : `0.1.0` (legacy) + `0.2.0` (corrigé) dans chaque manifest.

## Bras D vs D* (contamination)

| Bras | `priors_source` | Description |
|------|-----------------|-------------|
| **D** | `production_mined` | API v2 sur priors minés / réparés en base |
| **D\*** | `pilot_cases` | Post `seed:pilot-signatures` — hypothèses issues des fichiers cas (vraie cause incluse) |

L'écart **D\* − D** sur `convergence_at_5` et `expert_path_first_hit_rate` mesure le coût de la couverture insuffisante des priors production.  
Le held-out doit tracer `priors_source` comme dimension de contamination (canal latéral Supabase).

## Gate S2 (priors production)

Critères automatisés via `pnpm check:s2-priors` :

- 0 signature à 1 seule hypothèse
- 0 prior `> 0.85`
- moyenne ≥ 2 hypothèses / signature
- `pct_signatures_sans_cause_reelle` ≤ 5 %
- `entropie_mediane` ≥ 2 bits

Fixtures §8 : `pnpm check:s2-priors -- --fixture` (singleton + filler-only doivent échouer).

Re-minage : `pnpm exec tsx scripts/mine-diag-priors.ts` (WebApp, Neon → Supabase). `repair-diag-priors.ts` désactivé sans `--force`.

## Règle invariant (§8)

> **Tout invariant est livré avec un cas de test synthétique qui le fait échouer.** S'il est impossible d'en fabriquer un, l'invariant n'en est pas un.

| Invariant | Test d'échec |
|-----------|--------------|
| S2 priors | `check-s2-priors --fixture` |
| Polarité audit | `scripts/audit-polarity.test.ts` |
| `premature_closure_rate` | `scorer-v2.test.ts` (0 conclusion → `null`) |
| O_bayes plafond | `o-bayes-posterior-snapshot.test.ts` + plancher ≥ 11/15, anti-tautologie < 1 |

## Gates à dénominateur nul

`premature_closure_rate` et `wrong_part_rate` valent `null` si le dénominateur est vide — **tout gate CI sur `null` échoue**.

---

## v3 — Pré-enregistrement P2 (moteur observation quantitative)

**Version** : 2026-07-27-v3-p2-run  
**Corpus pilote** : `dataset/pilot/pilot-v3-pac_air_eau.jsonl` — **13 cas** PAC (`pac_air_eau`).

### Protocole P2 (gelé avant run)

| Règle | Contenu |
|---|---|
| Baselines roster-10 | `O_bayes_db` et `O_bayes` recalculés sur les **10** cas `GATE_DIAGNOSTIC_CASE_IDS` ; les valeurs 0,25 / 0,80 (15 cas toutes familles) sont **historiques** uniquement |
| Gate escalade | `escalation_recall = 3/3` sur hb2-0016/17/19 ; `false_conclusions_on_escalade = 0` — gate **secondaire bloquant** |
| Discipline post-run | Toute modification de `fault-tree-v3-pac_air_eau.json` ou des plages après le premier run → run **post-hoc** (`manifest.post_hoc: true`) ; le premier chiffre H3 tranche |

### Roster gate (pinné)

| ID | `meta.family` | Rôle |
|---|---|---|
| hb2-0001, hb2-0002, hb2-0003, hb2-0004, hb2-0005, hb2-0007, hb2-0010, hb2-0011, hb2-0013, hb2-0015 | diagnostique | **in** — mesure EIG H1 + gate H3 conv@5 |
| hb2-0016 | `escalade_legitime` | **out** — SAV constructeur (U0), déverrouillage usine |
| hb2-0017 | `escalade_legitime` | **out** — garantie compresseur, ouverture interdite |
| hb2-0019 | `escalade_legitime` | **out** — sous-dimensionnement BE |

→ **Dénominateur gate H3** : **10 cas diagnostiques** (pas 13). Source : `lib/v3/gate-roster.ts`.

| Hypothèse | Seuil | Baseline | Vérification |
|-----------|-------|----------|--------------|
| **H1** (EIG polarité calculée) | médiane poolée > 0 ; `pct_exact_zero` < 30 % | v2 plein : médiane 0, 79,7 % (900 couples) | `pnpm measure:eig-pilot-v3` |
| **H1b** (contrôle dénominateur) | v2-restreint (10×19 MES/OBS) ≥ 50 % EIG=0 | v2-restreint : **61,1 %** | `pnpm measure:eig-pilot-v2-restricted` |
| **H2** (contrefactuelle) | hb2-0005 : `MAN-REMPLISSAGE` confirme `pression_basse` ; `REM-FLOWSWITCH` refute `flowswitch_hs` | — | `scorer/v3/counterfactual-hb2-0005.test.ts` |
| **H3** (gate falsification) | `O_tree_db` conv@5 ≥ 0,55 sur **10 cas diagnostiques** | `O_bayes_db` roster-10 (recalculé) ; plafond `O_bayes` roster-10 (recalculé) ; historique 15 cas : 0,25 / 0,80 | P2 — `reports/falsification-v3-*.md` |
| **H4** (granularité LR) | ajuster LR hors 3 crans change conv@5 de ≤ 1 cas | — | P2 |
| **H5** (sélecteur) | `max_top_prior(D_v3) > max_top_prior(R)` | invariant §9.3 | P3 |

**Connaissance** : arbre `fault-tree-v3-pac_air_eau.json` + `quantities-v3.json` — **aucune donnée de cas gate** dans la connaissance (§2.6 P0). Priors P1 : stub uniforme (`config/priors-v3-pac_air_eau.json`), pas de minage pilote.

**Résultat P1 (2026-07-27)** :

| Mesure | % EIG=0 | Médiane EIG | Verdict |
|--------|---------|-------------|---------|
| v2 plein (15×60) | 79,7 % | 0 | baseline |
| v2 restreint (10×19) | **61,1 %** | 0 | H1b PASS (≥ 50 %) |
| v3 (10×19) | **26,3 %** | **0,2625** bit | H1 PASS (< 30 %) |

**H1 tranchée** : la chute 79,7 → 26,3 % n'est pas uniquement un effet de périmètre action — v2-restreint reste à 61,1 % alors que v3 tombe à 26,3 % sur le **même** dénominateur. Rapport : `reports/eig-pilot-v2-restricted-2026-07-27.md`.

### Résultat P2 (2026-07-27)

| Hypothèse / gate | Résultat | Verdict |
|---|---|---|
| **H3** `O_tree_db` conv@5 | **1/10** = 0,10 | **FAIL** (< 0,40 → NO-GO P3) |
| Gate escalade | recall **3/3**, false conclusions **0** | **PASS** |
| **H4** granularité LR | delta **1 cas** (tier3 1/10 vs adjusted 2/10) | **PASS** |
| O_bayes roster-10 | **10/10** | plafond recalculé |
| O_bayes_db roster-10 | non mesuré (Supabase absent au run) | — |

Rapport : `reports/falsification-v3-2026-07-27.md` — **décision : NO-GO P3**, repivot élicitation Marcel lourde ; moteur v3 conservé.
