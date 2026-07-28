# Évaluation H0 — Phase 0 DATA v3 (jour 3)

**Date** : 2026-07-27  
**Famille** : `pac_air_eau`  
**T_cutoff** : 2026-04-01

## Hypothèse H0

> Plages nominales + effets directionnels des 17 causes PAC air/eau récupérables à **≥80 % des arêtes `status: sourced`**, 100 % des causes avec ≥2 effets mesurables.

Les arêtes `draft` **ne comptent pas** dans le dénominateur.

## Résultats `check-tree-coverage.ts`

| Métrique | Valeur | Seuil | Statut |
|----------|--------|-------|--------|
| Causes | 17/17 | 17 | ✅ |
| Effets par cause (hors résiduelle) | ≥2 | ≥2 | ✅ |
| Arêtes totales | 37 | — | — |
| Arêtes sourced | 35 | — | — |
| **% sourced** | **94,6 %** | ≥80 % | ✅ |
| Séparabilité top-8 | 28/28 paires | 100 % | ✅ |
| Parité canonical | OK | — | ✅ |

### Arêtes draft restantes (hors dénominateur H0)

| Cause | Grandeur | Note |
|-------|----------|------|
| `pompe_grippee` | `amperage_circulateur` low | Variable selon type pompe |
| `compresseur_hs` | `amperage_compresseur` low | Variable selon modèle inverter |

Revue Marcel : `workflow/marcel-review-v3-resolved.csv` — **24 arêtes** tracées (22 `marcel:2026-07-27` sourced + 2 draft ampérage). Parité vérifiée par `npm run check:marcel-review-parity`.

## Autres livrables P0

| Critère | Résultat |
|---------|----------|
| Parseur pilote (47 tests PAC) | 72,3 % parsed/mapped |
| Cas dev Neon forum | 12 cas, 11 causes |
| Contamination (5 règles) | ✅ vert |
| Fallback `pickNextAction` | supprimé → `escalate` + test unitaire |
| Pilote v3 réécrit | 13 cas (`pilot-v3-pac_air_eau.jsonl`) |
| hb2-0001 / hb2-0005 | patches confirmatoire + contrefactuelle |

## Décision

**GO P1** — H0 satisfaite sur arêtes sourcées (94,6 % > 80 %). Les 2 arêtes draft restantes sont tracées et n'invalident pas l'hypothèse.

**Fermeture dossier P0 (27 juil.)** :
- `marcel_review` pointé dans `config/knowledge-v3-manifest.json` → `workflow/marcel-review-v3-resolved.csv`
- Spot-check 3 URLs harvest : 3/3 live, 0 quarantaine (`reports/harvest-url-spotcheck-2026-07-27.json`)

Prochaine étape : implémenter moteur v3 (polarité calculée, arbre, priors Dirichlet spec `docs/priors-v3-merge.md`). Gates de sortie P1 : **H1** (`pct_exact_zero` < 30 %), **H2** (hb2-0005 contrefactuel). P2 : **H3** `O_tree_db ≥ 0,55` sur 13 PAC pilote.
