# Jalon M3 — Métrique métier FTFR

## Question

Quelle corrélation entre `conv@3` pilote et First-Time-Fix-Rate terrain ?

## Instrumentation prod

Tables existantes :

- `diag_sessions` — sessions ouvertes/fermées
- `diag_turns` — historique tours + posterior

## Méthode

1. Extraire `conv@3` par signature équipement|code sur pilote + public.
2. Croiser avec FTFR terrain (à instrumenter côté produit / CRM).
3. Rapport trimestriel : `reports/ftfr-correlation-YYYY-QN.json`.

## Seuil exploratoire

| ρ(conv@3, FTFR) | Interprétation |
|---|---|
| > 0,5 | Métrique bench défendable commercialement |
| 0,2–0,5 | Signal faible — affiner causes |
| < 0,2 | Revoir taxonomie ou seuil 0,85 |

## Script (à brancher quand FTFR disponible)

```bash
pnpm exec tsx scripts/correlate-ftfr.ts --pilot-runs runs/pilot-v2-d-* --ftfr-csv data/ftfr-terrain.csv
```
