# Préregistration — Bench Harnais-AskMarcel (T9)

**Figé avant tout run gate** (leçon O7/O9). Premier run gate = le chiffre ; toute retouche ensuite → itération sur dev uniquement.

**Date de rédaction** : 2026-07-28  
**Dernière mise à jour** : 2026-07-30 (L0/G4 asymétrie, G0 retries, escalade_ok L0=null)  
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

**Upstream OpenRouter (bench)** — triplet O10 complet, pas le slug modèle seul :

| Paramètre | Valeur bench | Rôle |
|-----------|--------------|------|
| `models` | `[fast-marcel.apiIdentifier]` | Pin modèle |
| `provider.allow_fallbacks` | `false` | Pas de bascule modèle |
| `provider.require_parameters` | `true` | **Exclut les upstreams sans `tools`** (ex. Baidu sur `deepseek-v4-flash`) |
| `provider.only` | `AtlasCloud` (défaut, validé n=20 2026-07-30) | Pin reproductible ; `DeepSeek` si privacy débloquée ; surcharge `AM_HARNESS_OPENROUTER_PROVIDER_ONLY` |

**Production** (`/api/chat`, mobile) : `require_parameters: true` également (depuis 2026-07-30) — sans `only`, le routage reste libre entre upstreams tools-capables.

Inscrit dans le manifest : `openrouter_provider_only`, `openrouter_require_parameters`. **Exclure Morph** (uptime ~28 %).

**Ordre de préférence bench** (quantisation + uptime) :
1. **AtlasCloud** — fp8, uptime ~99,98 %, `structured_outputs` — **défaut validé** sur ce compte (n=20 LW, 2026-07-30)
2. **DeepSeek** — natif, cache implicite (repasser en défaut si privacy OpenRouter débloquée)
3. **Parasail** — fp8, `structured_outputs`
4. **DeepInfra** — **fp4 seul du pool** ; dernier recours uniquement, limite connue O6 si utilisé

**Leçon 2026-07-30** : router libre + tools → upstreams sans `tools` → `No output generated` / écran vide prod. `only: ['Baidu']` aggrave le taux d'échec bench.

**Provenance WebApp** : `webapp_git_sha` = HEAD, suffixé `-dirty` si arbre sale ; `webapp_worktree_fingerprint` = hash(`status --porcelain` + `diff HEAD`). **Gate interdit** sur arbre dirty (`assertWebappGitCleanForGate`). Un run dont le manifest affiche `5a513ad` sans `-dirty` alors que le worktree contenait des changements non commités est **non publiable** (récidive G4 #30368300281).

- Température simulateur : **0**
- Température juge : **0**
- Température bras testé : **0 en bench uniquement** (`benchMode` / `AM_HARNESS_BENCH_MODE`) — prod inchangée
- `allow_fallbacks` en bench : **false** (`AM_HARNESS_BENCH_MODE=true`)
- Budget steps LW = PROD : **6** (HB isole uniquement les tools DATA)
- Réplicats par cas : **3**
- Tours max par dialogue : **12** (arrêt anticipé si `presentDiagnostic` accepté)

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
| **G0** | `blocked` (tout bras du run) | **= 0** après ≤ **N** tentatives automatiques par réplicat (**N = 2**, voir §G0 retries) — sinon run **invalide**, scores non publiables |
| **G1** | `cause_ok` (médiane réplicats, bras PROD, **split gate**) | ≥ 8/10 |
| **G2** | `solution_ok` (idem) | ≥ 7/10 |
| **G3** | Escalades attendues (split gate : ham-0010, ham-0015) — type **et** motif | **2/2** |
| **G3** | `conclusion_sans_mesure` | 0 |
| **G4** | **PROD > L0** sur dev (médiane/cas, n=10) | PROD gagne sur **≥ 2 cas** vs L0 (marge pré-déclarée) — **asymétrie connue** : L0 n'a pas `presentDiagnostic` → toujours **T_MAX** tours, `verdict = null` ; transcripts plus longs que LW/PROD (voir §L0) |

### G0 — retries (déclaré avant lecture T11)

- **Politique cible** : retry automatique borné dans `sendHarnessTurn` sur `finishReason === 'error'`, compté (`retries` sur le record + `max_retries` dans le manifest).
- **T11 L0 (run `am-l0-2026-07-29T20-08-21-685Z`)** : manifest affiche `webapp_git_sha: 5a513ad` **sans `-dirty`** alors que le worktree contenait des changements bench non commités (`temperature: 0`, `allow_fallbacks: false`, etc. absents de `5a513ad`). **Run non publiable** — code exécuté inconnu, incomparable à LW/PROD sur `0a092d4`.
- Relancer jusqu'à ce que ça passe **sans compteur** vide G0 de son sens (mesure la persistance de l'opérateur, pas la fiabilité du harness).

### L0 — critères et comparabilité (déclaré avant résultats T11)

| Point | Effet |
|-------|--------|
| Pas de `presentDiagnostic` (`enableDiagnosticTool: false`) | Arrêt anticipé **impossible** → **13 tours technicien** systématiques, `verdict = null` |
| `escalade_ok` sur L0 | **`null`** (non évaluable), jamais `false` par défaut |
| `median_nb_tours` L0 vs LW/PROD | **Non comparable** — L0 = plafond structurel, pas comportement modèle |
| **G4** (juge sur transcript intégral) | Compare des **artefacts différents** : L0 = dialogue long sans verdict ; PROD/LW = arrêt au diagnostic. Asymétrie **connue**, pas une découverte post-hoc |

> **Surveillance LW/PROD** : si plusieurs réplicats touchent **T_MAX = 12** sans verdict, `escalade_ok` / `conclusion_sans_mesure` retombent en `null` (même règle que budget épuisé).
| **G5** | Écart PROD ↔ Marcel (bras H, 5 cas gate) | ≤ 1 cas |

### Bras LW — attribution, pas gate

**LW** mesure l'apport des **tools DATA** uniquement — même budget de steps que PROD (**6**). Ce n'est **pas** un gate d'ordre. L'attribution tools vs prompt est **HB** (PROD − LW ≥ 2 cas gagnants sur dev).

> Ancien G4 `PROD > LW > L0` **abrogé** (2026-07-29) : forçait l'échafaudage à battre un LLM nu — gate mal posé, risque d'overfit.

### Métriques publiées (hors gate)

| Métrique | Publication | Décision release |
|----------|-------------|------------------|
| `hallucination_plage_rate` | Toujours dans `score.json` + `hallucination_details` par réplicat | **Revue manuelle obligatoire** des détails avant interprétation — **aucun seuil automatique** (gate interdite) |

`escalade_ok` compare le **motif** (`escalade_motif` === `escalade_attendue`), pas seulement `verdict.type === 'escalade'`.

### Suivi données (hors lot code — validation Marcel)

**Taxonomie `quantities-v3.json`** — `t_depart` et `t_retour` n'ont pas de clé `radiateurs_ht` dans `nominal` (contrairement à `delta_t_eau`). Touche **5 cas** (`installation.emetteur = radiateurs_ht`). Ex. ham-0016 : `ground_state.t_depart: 60` vs `nominal.default [30,55]` — un technicien correct peut être compté en hallucination. **Action** : ajouter `radiateurs_ht` à `t_depart` / `t_retour` après validation Marcel, avant T12 gate.

**`continuite_sonde_ohm` conflate deux mesures distinctes** (découvert 2026-07-29 en construisant la partition HB-A). `nominal.default = [0, 500]` est une plage de **test de continuité** (court-circuit / coupure). Or la `verite.verification` de ham-0011 attend « résistance CTN 10k cohérente avec la température eau (~6 000–7 000 Ω à 35 °C) » — la **valeur ohmique de la thermistance**, hors de [0, 500]. Un technicien qui annonce correctement 6–7 kΩ est compté en hallucination. **Action** : scinder en `continuite_sonde_ohm` (continuité) et `resistance_ctn_ohm` (valeur thermistance, conditionnée par température), ou requalifier la plage. Validation Marcel avant T12.

**`resistance_ohm` trop large pour discriminer** — `nominal.default = [10, 50 000]`. Sur ham-0013, la vérification attend « résistance boucle < 5 Ω », **hors** de la plage sourcée. La grandeur existe donc pour `getPlages` (ham-0013 reste **INSTR** au sens du critère HB-A, qui porte sur la disponibilité de l'outil) mais elle n'ancre rien d'utile. Motif du marquage ⚠ sur ce cas.

---

## Hypothèses HA–HC

| ID | Énoncé |
|----|--------|
| **HA** | Le bras PROD passe G1–G3 sur gate |
| **HB** | Les tools DATA apportent ≥ 2 cas gagnants (**PROD − LW**) sur dev — bras d'attribution |
| **HC** | Accord juge ↔ Marcel ≥ 80 % sur les 5 cas bras H |
| **HB-A** | **Mécanisme** de HB : les tools DATA aident sur les causes **instrumentables** et nuisent sur les causes **non instrumentables** (partition ci-dessous) |

---

## HB-A — partition instrumentable / non instrumentable (déclarée AVANT T11)

**Origine** : smoke ham-0016 du 2026-07-29. PROD a conclu « EEV bloquée » 2 réplicats sur 3 sur un cas dont la cause est un sous-dimensionnement, après avoir mesuré HP (23 bar) et BP (8 bar) — **toutes deux en plage sourcée**. LW, sans tools DATA, a escaladé correctement 2 fois sur 3. C'est le `pieges[0]` du cas, mot pour mot.

**Hypothèse mécanique** : `getPlages` rend certaines grandeurs *sourçables*, donc attractives. Le modèle gravite vers ce qu'il peut mesurer avec autorité, au détriment des causes qu'aucun outil ne permet d'ancrer.

**Pourquoi cette section existe** : l'hypothèse est née de ham-0016, qui est **dans le split dev**. La tester sur les données qui l'ont engendrée, sans prédiction écrite d'avance, reproduirait au niveau interprétatif l'erreur des runs #30368300281 → #30393350693. La partition ci-dessous est figée **avant** le run T11 ; toute reclassification ultérieure est `post_hoc`.

### Critère de classement (mécanique, vérifiable)

> La cause vraie du cas est-elle **discriminée** par une grandeur numérique présente dans `taxonomy/quantities-v3.json` **avec une plage `nominal`** — c'est-à-dire interrogeable par `getPlages` ?

Discriminée, pas seulement corrélée : une mesure qui varie avec le symptôme mais ne distingue pas la cause d'une autre ne compte pas. Le critère porte sur les outils **qui existent**, pas sur ce qui est physiquement mesurable.

### Partition figée

| Cas | Cause vraie (abrégée) | Grandeur discriminante | Classe |
|---|---|---|---|
| ham-0001 | air dans le circuit après vidange | `pression_circuit_bar`, `delta_t_eau` | **INSTR** |
| ham-0008 | EEV bloquée partiellement ouverte | `surchauffe_k`, `sous_refroidissement_k` | **INSTR** |
| ham-0011 | fil de sonde départ sectionné | `continuite_sonde_ohm`, `resistance_ohm` | **INSTR** |
| ham-0012 | fusible circulateur grillé | `amperage_circulateur` (plage 0,3–2,5 A) | **INSTR** |
| ham-0013 | câble de liaison sectionné (rongeurs) | `resistance_ohm` (boucle < 5 Ω) — *limite* | **INSTR** ⚠ |
| ham-0004 | vanne 3 voies grippée, moteur sain | observation mécanique (`TEST-MOTEUR-VANNE`, `OBS-VANNE`) | **NON-INSTR** |
| ham-0014 | carte à déverrouiller via outil SAV | aucune — blocage organisationnel | **NON-INSTR** |
| ham-0016 | PAC sous-dimensionnée | aucune — `CALCUL-DEPERDITIONS`, tout est en plage | **NON-INSTR** |
| ham-0019 | résistance ECS entartrée | `t_ecs_ballon` / ampérage résistance **absents** de la taxonomie — *limite* | **NON-INSTR** ⚠ |
| ham-0020 | isolement compresseur marginal (0,3–0,9 MΩ) | `isolement_compresseur_mohm` **absent** de la taxonomie | **NON-INSTR** |

**5 / 5.** Les deux cas marqués ⚠ sont limites : l'analyse est rejouée **avec et sans eux** (4/4) en test de sensibilité. Si la conclusion change selon qu'on les inclut, elle n'est pas robuste et doit être déclarée comme telle.

> ham-0020 est l'exemple de référence du critère : la cause est parfaitement mesurable au mégohmmètre, mais `isolement_compresseur_mohm` n'existe pas dans `quantities-v3.json`. Elle est donc **non instrumentable par le harnais**, ce qui est la seule chose que HB-A prétend mesurer.

### Prédiction et falsification

Unité statistique = **le cas** (médiane des 3 réplicats), `cause_ok` du juge. Par cas : PROD gagne / égalité / PROD perd contre LW.

| | HB-A vraie | HB-A fausse |
|---|---|---|
| **ham-0008** (le plus instrumentable) | PROD ≥ LW | PROD perd aussi |
| **ham-0016** (le moins instrumentable) | PROD < LW | PROD gagne ou égalité |
| **Répartition des pertes PROD** | ≥ 3 des pertes dans NON-INSTR | pertes réparties uniformément |

**La paire ham-0008 / ham-0016 est le test le plus tranchant** : ham-0008 est le miroir exact de l'erreur observée — sa vraie cause *est* l'EEV, précisément ce que PROD a diagnostiqué à tort sur ham-0016. Si PROD gagne les deux, le biais n'existe pas et le smoke était du bruit sur n=1.

**Si HB-A est confirmée** : le correctif est une règle de prompt (« une valeur en plage n'est pas un indice, c'est une exclusion — ne construis pas d'hypothèse sur une grandeur nominale »), pas un retrait des tools.

**Si HB-A est infirmée** : ham-0016 est traité comme un cas isolé, aucune itération de prompt n'est faite sur ce motif, et HB reste évaluée telle quelle.

### Limites déclarées d'avance

n = 5 cas par cellule × 3 réplicats. L'IC est large (~±30 pts, cf. leçon 2026-07-28). **Ceci est un test de direction et de mécanisme, pas un test de significativité.** Aucun seuil de p-value n'est déclaré et aucun ne sera calculé post-hoc. Un résultat conforme à la prédiction rend le mécanisme *plausible et testable sur le gate* ; il ne le démontre pas.

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
