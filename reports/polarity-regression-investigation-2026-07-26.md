# Investigation polarité — régressions hb2-0008 / 0010 / 0014

Date : 2026-07-26

## Contexte

Après retrait du court-circuit `resolves` et migration `migrate-polarity-pilot.ts`, trois cas
sous le seuil 0,85 alors qu'un rejeu antérieur les plaçait à ~0,93–0,97.

## Verdict par cas

### hb2-0010 — **étiquette fausse (corrigée)**

| Champ | Valeur |
|---|---|
| Test | `REM-SONDE` |
| Observation | « Régulation **stable après remplacement** sonde » |
| Avant | `polarity: refutes` sur `sonde_hs` (heuristique `stable` → refutes) |
| Après | `polarity: supports` |
| Posterior vraie cause | 0,728 → **0,944** |
| Convergence | non → **oui** |

**Défense :** la réparation confirme la cause discriminée ; ce n'est pas un test « normal/stable »
qui infirme la sonde. Le facteur `refute=0,4` divisait la masse de la vraie cause au lieu de
la multiplier par 2,5.

### hb2-0008 — **pas de refutes sur la vraie cause sur expert_path**

| Étape expert_path | Polarité | Discrimine |
|---|---|---|
| OBS-GELEE | supports | degivrage, charge (pas filtre) |
| MAN-NETTOYAGE-FILTRE | supports | filtre_colmate ✓ |
| MAN-RESET | supports + resolves | filtre_colmate ✓ |

Posterior `filtre_colmate` : **0,832** (identique à « tout supports »).

`MES-HP-BP` (`refutes` + `eliminates` charge) **n'est pas** sur `expert_path`.
Si on l'ajoute : posterior **0,898** (convergence).

L'écart vs ~0,93 n'est **pas** un refutes sur la vraie cause ; c'est soit un chemin expert
plus long (MES-HP-BP), soit un plafond antérieur gonflé par le court-circuit `resolves`.

### hb2-0014 — **idem, polarités expert_path cohérentes**

| Étape | Polarité | Discrimine |
|---|---|---|
| OBS-CONDENSATS | supports | condensats_bouches ✓ |
| MAN-DESENGORGEMENT | supports + resolves | condensats_bouches ✓ |

Posterior : **0,831** — sous seuil 0,85 de peu. Pas de bascule refutes sur la vraie cause.

## Conséquences chiffrées (corrigées)

| Métrique | Valeur |
|---|---|
| O_bayes conv@5 | **12/15 = 0,80** |
| O_bayes_db conv@5 | 0,30 |
| Écart réel | **0,80 − 0,30 ≈ 0,50** |
| Cible O_bayes_db réaliste | ~0,45–0,50 |

(11/15 = 0,73 avant correction hb2-0010.)

## Garde-fous tests

- `conv@5 < 1` anti-tautologie
- `conv@5 >= 11/15` plancher
- `fixtures/o-bayes-posterior-snapshot-v1.json` — diff sur changement de modèle

## migrate-polarity-pilot.ts

Heuristique mise à jour : `resolves` + observation de rétablissement → `supports`
(mot-clé `stable` seul ne suffit plus si « après remplacement/rétabli »).
