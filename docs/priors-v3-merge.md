# Spécification — fusion des priors v3 (Dirichlet)

**Statut P0** : spécification uniquement — aucune implémentation moteur.

## Objectif

Combiner des priors issus de sources hétérogènes (minage production, cas historiques forum, élicitation Marcel) en une distribution conjointe sur les 17 causes `pac_air_eau`, sans contamination circulaire avec le pilote gate.

## Entrées

| Source | Poids relatif | Contraintes |
|--------|---------------|-------------|
| `production_mined` | α₀ = 1 par cause observée | `published_at < T_cutoff`, `PRIOR_CAP` |
| `forum_dev` | α = 0,5 max par cause | cas `split: public` Neon uniquement — jamais pilote |
| `marcel_elicitation` | α libre | tracé `marcel:YYYY-MM-DD` |

## Paramètres

- **`PRIOR_CAP`** : plafond par cause = `min(0,35, N_obs / N_total × 2)` après normalisation.
- **`N_MIN`** : minimum 30 observations agrégées avant d'activer un prior miné (sinon prior uniforme locale).
- **`T_cutoff`** : `2026-04-01` — aucune observation post-cutoff dans le minage.

## Fusion Dirichlet

Pour chaque cause `c` :

```
α_c = α_prior_c + Σ_k w_k × count_k(c)
```

Normalisation :

```
π_c = α_c / Σ_j α_j
```

Si `π_c > PRIOR_CAP` : réallouer l'excédent vers `cause_inconnue` (résiduelle non concluable).

## Règles anti-contamination

1. Exclure tout `case_id` matching `hb2-*` ou `hb3-pilot-*` du minage priors.
2. Les cas pilote réécrits v3 servent **uniquement** à calibrer le seuil de conclusion (P2), pas les α.
3. Disjonction domaines forum ↔ `doc:{document_id}` OEM (cf. `check-knowledge-contamination.ts`).

## Sortie attendue (P1)

Fichier `config/priors-v3-pac_air_eau.json` :

```json
{
  "version": "priors-v3.YYYY-MM-DD",
  "family": "pac_air_eau",
  "T_cutoff": "2026-04-01",
  "dirichlet_alpha": { "air_circuit": 2.1, "...": 1.0 },
  "sources": ["production_mined:2026-07", "marcel:2026-07-27"]
}
```

## Critères d'acceptation P1

- Somme des priors = 1 ± 1e-6
- Aucune cause > `PRIOR_CAP` sauf `cause_inconnue`
- Rank turn-0 sur pilote v3 ≥ baseline `O_bayes_db` recalculée
