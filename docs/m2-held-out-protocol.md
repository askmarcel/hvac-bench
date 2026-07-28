# Jalon M2 — Validité prédictive held-out

## Prérequis

- S1–S4 livrés sur pilote (20 cas).
- Gate v1 (52 cas) maintenu VERT.

## Dimensionnement

1. Mesurer taux de paires discordantes D vs B/E sur pilote (`run:v2:compare`).
2. Dimensionner held-out selon preregistration.md (McNemar, ~8 % discordant → 300+ cas si nécessaire).
3. Held-out privé : `hvac-bench-heldout/`.

## Pinning scaffold (manifest)

Chaque run doit inclure :

- `models_version` (`config/models-v2.json`)
- `likelihoods_version` (`config/likelihoods-v2.json`)
- `matrix_version`
- `T_cutoff` (2026-04-01)
- `preregistration_hash`

## Métrique

ρ(rang public, rang held-out) sur les cas diagnosticables.

## Commandes

```bash
pnpm run:v2:arm-d --cases ../hvac-bench-heldout/dataset/gate-v2.jsonl
pnpm check-run-integrity -- --run-dir runs/<id> --arm D
```
