# Contrôle H1 — v2 restreint vs v3

**Date** : 2026-07-27

## Dénominateur (pinné)

| Paramètre | Valeur |
|-----------|--------|
| Cas diagnostiques | 10 (hb2-0001, hb2-0002, hb2-0003, hb2-0004, hb2-0005, hb2-0007, hb2-0010, hb2-0011, hb2-0013, hb2-0015) |
| Actions | 19 MES/OBS |
| Couples action×cas | 190 |
| Exclus pilote (13) | hb2-0016, hb2-0017, hb2-0019 (`escalade_legitime`) |

## Résultats

| Mesure | % EIG=0 | Médiane EIG |
|--------|---------|-------------|
| v2 plein (baseline) | 79.7 % | 0.0000 bit |
| **v2 restreint** | **61.1 %** | 0.0000 bit |
| **v3** (même roster) | **26.3 %** | 0.2625 bit |

## Verdict H1

**H1_SOLIDE — v2-restreint reste ≥ 50 % EIG=0 ; la chute v2→v3 est majoritairement modèle**

Seuil : v2-restreint ≥ 50 % EIG=0 → H1 solide ; v3 < 30 % requis.
