# Protocole Bras H — baseline humaine

## Objectif

Mesurer la performance de techniciens réels sur le pilote v2 **après** assainissement des hypothèses (S2) et polarité (S3).

## Protocole aveugle

1. Marcel + 2–3 techniciens reçoivent uniquement `symptom.narrative`, `context`, `initial_readings`.
2. Pas d'accès aux `tests[]`, `expert_path`, ni aux priors minés.
3. Chaque reviewer propose une `cause_id` parmi le vocabulaire canonique (17 causes).
4. Saisie dans `workflow/pilot-v2-human-review.csv`.

## Format CSV

```csv
case_id,human_cause_id,reviewer,blind
hb2-0001,air_circuit,marcel,1
hb2-0002,air_circuit,tech_a,1
```

## Exécution

```bash
pnpm run:v2:arm-h
```

## Comparaison

McNemar D vs H au niveau cas (`pnpm run:v2:compare` avec bras H).

## Gate

- Baseline de référence pour M3 (corrélations terrain FTFR).
- Ne pas lancer avant validation `expert_path` (20/20 approved).
