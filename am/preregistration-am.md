# Préregistration — Bench Harnais-AskMarcel (T9)

**Figé avant tout run gate** (leçon O7/O9). Premier run gate = le chiffre ; toute retouche ensuite → itération sur dev uniquement.

**Date de rédaction** : 2026-07-28  
**Statut rosters** : ✅ Appliqués le 2026-07-28 (stamp `marcel:2026-07-28`, seed `20260728`)

---

## Modèles épinglés (O10)

| Rôle | Variable CI | Modèle (à renseigner en secrets) |
|------|-------------|----------------------------------|
| Bras testé (PROD/LW/L0) | `AM_HARNESS_MODEL_ID` | `fast-marcel` |
| Simulateur installateur | `AM_SIM_MODEL` | _secret_ |
| Juge (distinct du bras et du sim) | `AM_JUDGE_MODEL` | _secret_ |

- Température simulateur : **0**
- Température juge : **0**
- Réplicats par cas : **3**
- Tours max par dialogue : **12**

---

## Rosters (à appliquer après visios Marcel)

Commande de tirage (seed documentée) :

```bash
pnpm am:stamp-marcel --date YYYY-MM-DD --all   # après les 2 visios
pnpm am:split-dev-gate --seed 20260728 --apply  # puis commit de ce fichier
```

**Seed de tirage** : `20260728` (à confirmer au moment du split réel)

### DEV (10 cas — itération libre)

ham-0001, ham-0004, ham-0008, ham-0011, ham-0012, ham-0013, ham-0014, ham-0016, ham-0019, ham-0020

### GATE (10 cas — verrouillés, jamais en dev)

ham-0002, ham-0003, ham-0005, ham-0006, ham-0007, ham-0009, ham-0010, ham-0015, ham-0017, ham-0018

---

## Gates G1–G5

| ID | Critère | Seuil |
|----|---------|-------|
| **G1** | `cause_ok` (médiane réplicats, bras PROD, gate) | ≥ 8/10 |
| **G2** | `solution_ok` (idem) | ≥ 7/10 |
| **G3** | Escalades attendues | 3/3 |
| **G3** | `conclusion_sans_mesure` | 0 |
| **G3** | `hallucination_plage` | 0 |
| **G4** | Ordre bras sur dev | PROD > LW > L0 |
| **G5** | Écart PROD ↔ Marcel (bras H, 5 cas gate) | ≤ 1 cas |

---

## Hypothèses HA–HC

| ID | Énoncé |
|----|--------|
| **HA** | Le bras PROD passe G1–G3 |
| **HB** | Les tools DATA (`get_plages`, `get_arbre_memo`, `get_priors`) apportent ≥ 2 cas gagnants (PROD − LW) sur dev |
| **HC** | Accord juge ↔ Marcel ≥ 80 % sur les 5 cas bras H |

---

## Règle post-hoc

Toute modification de prompt, tool ou cas après le premier `am:run-gate` complet est déclarée **post_hoc**. L'itération se fait sur le split **dev** uniquement ; re-gate hebdomadaire déclaré.

---

## Hash

Le hash SHA-256 tronqué (16 hex) de ce fichier est inscrit dans `manifest.json` (`preregistration_hash`) à chaque run.
