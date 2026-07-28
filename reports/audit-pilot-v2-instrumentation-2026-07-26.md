# Audit d'instrumentation — pilote v2 D vs B vs E

Date : 2026-07-26
Statut : **le pilote `pilot-v2-D-vs-B-vs-E.md` ne supporte pas son verdict**
Portée : `runs/pilot-v2-live-2026-07-26/raw.jsonl` (180 enregistrements), `scorer/v2/index.ts`, `runners/v2-harness.ts`

---

## 1. Constat bloquant — le bras D n'a jamais fait de diagnostic

Répartition des actions proposées, sur l'ensemble des 180 sessions :

| Bras | actions émises | présentes dans `tests` du cas | actions `ESC-*` |
|------|---------------:|------------------------------:|----------------:|
| **D** | 276 | **5 %** | **88 %** |
| B | 242 | 43 % | 0 % |
| E | 223 | 38 % | 0 % |

Le moteur D parcourt le bloc escalade de la taxonomie dans l'ordre du registre :

```
ESC-BUREAU-ETUDES → ESC-CONSIGNATION → ESC-GARANTIE → ESC-PIECE-INDISPONIBLE → ESC-SAV
```

45 des 60 sessions D suivent l'un de **deux** chemins quasi identiques, indépendamment du cas
et de la cause vraie. Les 3 réplicats sont identiques sur **20/20** cas : le bras est
déterministe et n'exploite aucune observation.

**Cause probable** : les actions `ESC-*` ne sont pas exclues de l'ensemble candidat du
sélecteur `next_action` de l'API v2. Combiné au point 2 (famine d'observations), le moteur
n'a aucun signal pour départager et retombe sur l'ordre du registre.

**Conséquence** : ce run ne mesure pas la qualité diagnostique de D. Il mesure un
sélecteur d'action cassé. Le verdict « D perdant vs B/E » n'est **ni vrai ni faux** —
il est **non testé**.

---

## 2. Famine d'observations — l'environnement affame les trois bras

`runners/v2-harness.ts::lookupObservation` renvoie `"aucune information exploitable"`
pour toute action absente de `case.tests`. Les bras ne reçoivent jamais la liste des
actions réellement instrumentées pour le cas.

Résultat : **57 % des tours de B et 62 % des tours de E** sont des tours morts.
Sur un budget `T_MAX = 5`, le budget utile effectif est de ~2 tours, alors que
`expert_path` fait 2,9 actions en moyenne. Le plafond de performance atteignable
est structurellement bas — d'où l'effet plancher sur les trois bras.

**Correctif** : transmettre `available_actions` (les `action_id` de `case.tests`) dans
le payload d'ouverture de session, ou générer une observation par défaut plausible.

---

## 3. Quatre défauts du scorer qui inversent le classement

### 3.1 `escalation_precision` est structurellement égale à 1

Les compteurs `escTp / escFp` ne sont incrémentés que dans le bloc
`if (c.meta.family === 'escalade_legitime')`. Une escalade émise sur les 15 autres cas
n'est comptée nulle part. Or c'est exactement le mode de défaillance de D.

| Bras | escalade sur cas NON-escalade | précision publiée | précision recalculée sur tout le corpus |
|------|------------------------------:|------------------:|----------------------------------------:|
| D | 39/45 = **87 %** | 1,00 | **0,28** |
| B | 0/45 | 1,00 | 1,00 |
| E | 0/45 | 1,00 | 1,00 |

### 3.2 `premature_closure_rate` a le mauvais dénominateur

`premature / n` au lieu de `premature / concluded`. Un bras qui ne conclut jamais
obtient 0 %. Conditionné aux conclusions réelles :

| Bras | conclut | dont fausses | taux réel | taux publié |
|------|--------:|-------------:|----------:|------------:|
| D | 6/60 | 6 | **100 %** | 10,0 % |
| B | 12/60 | 7 | **58 %** | 11,7 % |
| E | 17/60 | 14 | **82 %** | 23,3 % |

Le classement publié (D meilleur que E) s'inverse.

### 3.3 `path_cost_ratio` récompense l'inaction et repose sur 6 cas

14 des 20 cas portent `flags.sparse_priors` et sont exclus. La médiane est calculée
sur **6 cas**. Le 1,00 de D correspond au coût de cinq appels d'escalade rapporté
au coût d'un parcours diagnostic expert — parité fortuite, sans contenu.
Une métrique de coût non conditionnée à la réussite est une anti-métrique.

### 3.4 `convergence_at_5` est redondante avec l'exactitude brute

`T_MAX = 5`, donc `turns <= 5` est toujours vrai. `convergence_at_5` == exactitude.
Seule `convergence_at_3` porte un gradient d'efficacité.

---

## 4. Puissance statistique

- D est déterministe (20/20 chemins identiques sur réplicats). Les 3 réplicats
  n'apportent aucune information pour D : **n_effectif = 20**, pas 60.
- Scorer au niveau enregistrement gonfle tous les dénominateurs d'un facteur 3.
- Au niveau **cas** (majorité des 3 réplicats) : D 0/20, B 1/20, E 1/20.
- McNemar sur 4 paires discordantes : p = 0,134, MDE ≈ 25–30 points.
  Rien de ce qui est inférieur à un écart massif n'est détectable ici.

Pour détecter un écart de +15 points de convergence avec 80 % de puissance,
il faut de l'ordre de **120–150 cas**, pas 20.

---

## 5. Effet plancher

Convergence : D 0 %, B 8,3 %, E 5 %. Les trois bras sont au plancher.
Un banc où tous les bras sont au plancher ne discrimine pas — il indique que
l'environnement, et non les modèles, est le facteur limitant (cf. §2).

---

## 6. Recommandations, par ordre de priorité

1. **Reclasser** `pilot-v2-D-vs-B-vs-E.md` en *invalide — instrumentation*.
   Ne pas propager le verdict « D perdant » en roadmap.

2. **Ajouter deux bras de calibration** avant toute comparaison :
   - **Bras O (oracle)** : joue `expert_path`. Critère d'acceptation : conv@5 ≥ 90 %.
   - **Bras R (aléatoire)** : action tirée au hasard dans `case.tests`. Attendu : ≈ plancher.

   Tant que O n'atteint pas son seuil, aucune comparaison de bras n'est interprétable.
   C'est l'action à plus fort rendement du backlog.

3. **Corriger la famine d'observations** (§2) — transmettre `available_actions`.

4. **Corriger le sélecteur D** : exclure `ESC-*` de l'ensemble candidat ;
   l'escalade est un état terminal, pas une action diagnostique.
   Ajouter une assertion de garde dans le harnais : échec du run si
   > 30 % des actions proposées sont `ESC-*` ou hors `case.tests`.

5. **Corriger les 4 défauts du scorer** (§3) + tests unitaires dans
   `scorer/scorer.test.ts` avec enregistrements synthétiques pour chacun.

6. **Repondérer la puissance** : scorer au niveau cas, réplicats réservés à
   l'estimation de variance. Dimensionner le held-out à ≥ 120 cas
   ou n'annoncer que la détection de gros effets.

7. **Rejouer D vs B** seulement après 2–6.

---

## 7. Note infrastructure

Le confond D-local / B-hébergé subsiste : le premier run D a produit 48/60
`rate_limit_exceeded`. Le correctif `BENCH_INTER_CALL_MS=1100` supprime l'erreur
mais laisse une asymétrie de conditions d'exécution entre bras. À documenter
dans le manifeste de run, et à neutraliser avant publication.

Le 404 sur `https://app.askmarcel.app/api/v2/...` n'est pas bloquant à ce stade :
la priorité est la validité du banc, pas le déploiement du bras D.
