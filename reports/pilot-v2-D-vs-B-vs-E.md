# Run pilote v2 — D vs B vs E (calibration v2)

Date : 2026-07-26  
**Statut run : INVALIDE — RÉTRACTÉ**  
Run : `3cd4b633`  
Motif : 88 % d'actions `ESC-*` sur bras D, tie-break UUID, fuite `discriminantExecuted`, scorer biaisé.

## Rétractation (audit S1, 26 juil. 2026)

Ce rapport ne doit plus être cité comme verdict Phase 7. Les métriques headline ci-dessous sont **historiques uniquement**.

Correctifs requis avant nouveau run :
- Scorer v0.3.0 (`wrong_part_rate`, `expert_path_first_hit_rate`)
- Suppression tie-break UUID dans `engine.ts`
- Fix `discriminantExecuted` dans `session-store.ts`
- Assainissement `diag_hypotheses` (S2)

## Métriques headline (scorer 0.2.0 — invalides)

| Bras | conv@3 | conv@5 | pass^3 (cas) | top3 | path_cost (n) | prem. closure† |
|------|-------:|-------:|-------------:|-----:|--------------:|---------------:|
| D | 0.0% [0.0–16.1%] | 25.0% [11.2–46.9%] | 25.0% | 0.0% | n/a (n=5) | 100.0% |
| B | 5.0% | 13.3% | 5.0% | 23.3% | n/a (n=8) | 46.2% |
| E | 5.0% | 10.0% | 10.0% | 15.0% | n/a (n=6) | 84.2% |

† Dénominateur = sessions conclues (v0.2.0)

## Verdict historique (non recevable)

~~D favorable ou équivalent (pass^3) — Phase 7 conditionnellement atteinte sur pilote.~~

**INVALIDE** — ne pas publier.
