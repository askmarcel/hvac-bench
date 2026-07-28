# Rapport falsification v3 — P2 gate

**Date** : 2026-07-27  
**Run kind** : falsification_p2_primary  
**Prereg hash** : 84b97844c30126891f8b9360b1d2661cd33ae8586cdbde6ddd93730359fda4e7

## Roster

- **10 diagnostiques** (H3) : hb2-0001, hb2-0002, hb2-0003, hb2-0004, hb2-0005, hb2-0007, hb2-0010, hb2-0011, hb2-0013, hb2-0015
- **3 escalade** (gate secondaire) : hb2-0016, hb2-0017, hb2-0019

## Baselines roster-10 (recalculées)

| Oracle | Roster-10 | Historique 15 cas |
|--------|-----------|-------------------|
| O_bayes | 10/10 = **1.000** | 12/15 |
| O_bayes_db | skipped (Supabase) | 3.75/15 (audit ~4/15) |

Baseline de référence H3 : **O_bayes_db roster-10** (non mesuré — credentials Supabase manquants) ; plafond **O_bayes roster-10** = 1.000.

## H3 — O_tree_db (juge principal)

| Métrique | Valeur | Seuil |
|----------|--------|-------|
| conv@5 | **1/10** = 0.100 | ≥ 0,55 |
| premature_closure_rate | 0 | — |

**Verdict H3** : FAIL

### Cas par cas (diagnostiques)

| Cas | Turns | Cause prédite | Cause vraie | État | OK |
|-----|-------|---------------|-------------|------|----|
| hb2-0001 | 3 | — | air_circuit | non_convergent | ❌ |
| hb2-0002 | 3 | — | air_circuit | non_convergent | ❌ |
| hb2-0003 | 4 | pompe_grippee | pompe_grippee | conclusion | ✅ |
| hb2-0004 | 3 | — | bypass_ferme | non_convergent | ❌ |
| hb2-0005 | 2 | — | pression_basse | non_convergent | ❌ |
| hb2-0007 | 3 | — | vanne_fermee | non_convergent | ❌ |
| hb2-0010 | 3 | — | sonde_hs | non_convergent | ❌ |
| hb2-0011 | 3 | — | air_circuit | non_convergent | ❌ |
| hb2-0013 | 3 | — | filtre_colmate | non_convergent | ❌ |
| hb2-0015 | 3 | — | sonde_hs | non_convergent | ❌ |

## Gate escalade (secondaire bloquant)

| Métrique | Valeur | Attendu |
|----------|--------|---------|
| escalation_recall | 3/3 | 3/3 |
| false_conclusions_on_escalade | 0 | 0 |

**Verdict escalade** : PASS

| Cas | Chemin | État | Concluded | OK |
|-----|--------|------|-----------|-----|
| hb2-0016 | MES-PRESSION→OBS-LED-DEFAUT→ESC-SAV | escalation | concluded=false | ✅ |
| hb2-0017 | MES-HP-BP→OBS-FUITE→ESC-GARANTIE | escalation | concluded=false | ✅ |
| hb2-0019 | MES-DEBIT→MES-DT-EAU→ESC-BUREAU-ETUDES | escalation | concluded=false | ✅ |

## H4 — Granularité LR

| Profil | LR (fort/moyen/faible) | conv@5 |
|--------|------------------------|--------|
| tier3_default | 10/3/1.5 | 1/10 |
| adjusted | 15/4/2 | 2/10 |

Delta : **1 cas** (seuil ≤ 1) — **PASS**

## Décision P3

**NO-GO P3** — conv@5 = 1/10 (0.100) < 0,40 ; prémisse « connaissance publique suffit » infirmée ; garder moteur v3, repivoter élicitation Marcel lourde



## Artefacts

- Baselines : `/Users/mac/Documents/AskMarcel-APP/hvac-bench/reports/oracle-baselines-roster10-2026-07-27.json`
- Run O_tree_db : `/Users/mac/Documents/AskMarcel-APP/hvac-bench/runs/o-tree-db-2026-07-27T08-47-27-904Z-e7ccd8fb`
- Sweep H4 : `/Users/mac/Documents/AskMarcel-APP/hvac-bench/reports/lr-granularity-sweep-2026-07-27.json`

## Discipline

Premier run P2 — `post_hoc: false`. Toute retouche arbre post-run requalifie le run suivant.
