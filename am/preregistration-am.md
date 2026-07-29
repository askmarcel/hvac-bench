# Préregistration — Bench Harnais-AskMarcel (T9)

**Figé avant tout run gate** (leçon O7/O9). Premier run gate = le chiffre ; toute retouche ensuite → itération sur dev uniquement.

**Date de rédaction** : 2026-07-28  
**Dernière mise à jour** : 2026-07-29 (G0/G4, transport O6, arrêt T11 complet par défaut)  
**Statut rosters** : ✅ Appliqués le 2026-07-28 (stamp `marcel:2026-07-28`, seed `20260728`)

---

## Transport bench (O6 — pré-hoc)

| Contexte | Cible mesurée | Transport | Compte pour gate ? |
|----------|---------------|-----------|-------------------|
| **T11, T12, smoke** | **Cœur harnais** (`runHarnaisTurn` via `bench-harnais-turn.ts`) | **in-process** (`--surface CORE`, défaut) | **Oui** — seule preuve O6 valide |
| Itération prompt locale | Idem | in-process | Non — boucle dev uniquement |
| **T14 surfaces** | Routes HTTP (S1 web, S2 mobile, S3 API v1) | `AM_HARNESS_TRANSPORT=http` + `--surface S1\|S2\|S3` | **Non** — conformité transport, pas le gate |

> **Le harnais ≠ `/api/mobile/chat`.** L'API mobile est une surface de transport. Le bench gate mesure `lib/chat/run-harnais.ts`. Les bugs parseur SSE client sont hors périmètre gate (T14).

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

## Rosters

**Seed de tirage** : `20260728`

### DEV (10 cas — itération libre)

ham-0001, ham-0004, ham-0008, ham-0011, ham-0012, ham-0013, ham-0014, ham-0016, ham-0019, ham-0020

### GATE (10 cas — verrouillés, jamais en dev)

ham-0002, ham-0003, ham-0005, ham-0006, ham-0007, ham-0009, ham-0010, ham-0015, ham-0017, ham-0018

---

## Gates G0–G5

| ID | Critère | Seuil |
|----|---------|-------|
| **G0** | `blocked` (tout bras du run) | **= 0** — sinon run **invalide**, scores non publiables |
| **G1** | `cause_ok` (médiane réplicats, bras PROD, **split gate**) | ≥ 8/10 |
| **G2** | `solution_ok` (idem) | ≥ 7/10 |
| **G3** | Escalades attendues | 3/3 |
| **G3** | `conclusion_sans_mesure` | 0 |
| **G3** | `hallucination_plage` | 0 |
| **G4** | **PROD > L0** sur dev (médiane/cas, n=10) | PROD gagne sur **≥ 2 cas** vs L0 (marge pré-déclarée) |
| **G5** | Écart PROD ↔ Marcel (bras H, 5 cas gate) | ≤ 1 cas |

### Bras LW — attribution, pas gate

**LW** mesure l'apport du **protocole seul** (sans tools DATA). Ce n'est **pas** un gate d'ordre. L'attribution tools vs prompt est **HB** (PROD − LW ≥ 2 cas gagnants sur dev).

> Ancien G4 `PROD > LW > L0` **abrogé** (2026-07-29) : forçait l'échafaudage à battre un LLM nu — gate mal posé, risque d'overfit.

---

## Hypothèses HA–HC

| ID | Énoncé |
|----|--------|
| **HA** | Le bras PROD passe G1–G3 sur gate |
| **HB** | Les tools DATA apportent ≥ 2 cas gagnants (**PROD − LW**) sur dev — bras d'attribution |
| **HC** | Accord juge ↔ Marcel ≥ 80 % sur les 5 cas bras H |

---

## Smoke parseur (pré-T11)

Avant tout T11 complet : **ham-0016 × 3 réplicats × {LW, PROD}** = 6 dialogues (`pnpm am:smoke-parseur`). Cas reproducteur (blocked 4× sur runs #30380551430 / #30393350693). Un seul réplicat = ~80 % de faux vert si taux blocked ≈ 20 %.

---

## Décision D1 (web 75 %) — actée 2026-07-29

**Option (b)** : `harnaisMode: 'lw'` sur `/api/chat` — 1 ligne, supprime l'incohérence prompt↔tools active en prod, réversible. PROD web **après** T13 + smoke, pas sur G4 non mesurable.

---

## Règle post-hoc

Toute modification de prompt, tool, gate ou cas après le premier `am:run-gate` complet est déclarée **post_hoc**. L'itération se fait sur le split **dev** uniquement ; re-gate hebdomadaire déclaré.

---

## Hash

Le hash SHA-256 tronqué (16 hex) de ce fichier est inscrit dans `manifest.json` (`preregistration_hash`) à chaque run.
